// Dev-only profiler for the half `npm run profile` cannot reach: what the
// *webview* costs. Run: npm run profile:webview
//
// The reason this exists rather than a note saying "open DevTools": the
// question the perf work turns on — whether a reload re-pays mermaid's parse and
// re-render, or gets it from a cache — cannot be answered by reading the source
// and cannot be answered from Node. It is a question about Chromium, so it is
// asked of a Chromium.
//
// It is asked *outside* VS Code on purpose. Putting a report-to-host message
// into src/shared/protocol.ts would buy the same numbers at the cost of shipping
// a "write this text somewhere" handler to every user, and a dev-only branch in
// a shipped bundle is exactly the unnecessary stuff this work set out to find.
// So the harness drives a real browser at the real page instead: same
// buildWebviewHtml, same vendored mermaid, same preview.js, same CSP, served
// over HTTP so the CSP's scheme sources behave as they do in a webview.
//
// What it does NOT reproduce, stated plainly so the numbers are not overread:
// the `vscode-webview://` origin, VS Code's own resource caching, and the
// webview's process reuse when retainContextWhenHidden is on. It measures one
// fresh page load and the load right after it, in one browser process.
//
// `require` rather than `import` keeps this file CommonJS, which is what lets
// Node run it directly; the cast reattaches the module type @types/node widens
// to `any`. See esbuild.ts for the full note.
const esbuild = require('esbuild') as typeof import('esbuild');
const fs = require('fs') as typeof import('fs');
const http = require('http') as typeof import('http');
const os = require('os') as typeof import('os');
const path = require('path') as typeof import('path');
const { spawn, execFileSync } = require('child_process') as typeof import('child_process');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'out', 'profile');

/** Console lines the page printed that start with this are ours. */
const REPORT_PREFIX = '[graphite.md profile]';

/** Give up waiting for a report after this long; a hung page must not hang CI. */
const REPORT_TIMEOUT_MS = 30_000;

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

interface CdpMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

interface Cdp {
  send(method: string, params?: unknown): Promise<unknown>;
  close(): void;
}

function findChrome(): string {
  for (const candidate of CHROME_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`no Chromium found; looked in:\n  ${CHROME_CANDIDATES.join('\n  ')}`);
}

/** Waits for `check()` to stop throwing, or gives up. */
async function waitFor<T>(what: string, check: () => Promise<T>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await check();
    } catch (err) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}: ${String(err)}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

async function connect(wsUrl: string, onEvent: (m: CdpMessage) => void): Promise<Cdp> {
  const ws = new WebSocket(wsUrl);
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let nextId = 1;

  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => { resolve(); }, { once: true });
    ws.addEventListener('error', () => { reject(new Error('CDP socket failed to open')); }, { once: true });
  });

  ws.addEventListener('message', (event: MessageEvent) => {
    const msg = JSON.parse(String(event.data)) as CdpMessage;
    if (msg.id !== undefined) {
      const slot = pending.get(msg.id);
      if (!slot) return;
      pending.delete(msg.id);
      if (msg.error) slot.reject(new Error(JSON.stringify(msg.error)));
      else slot.resolve(msg.result);
      return;
    }
    onEvent(msg);
  });

  return {
    send(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      ws.close();
    },
  };
}

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/**
 * Serves the repo, plus the page under test at /__page__.
 *
 * A real origin over HTTP rather than file://, because the page's CSP is written
 * in terms of scheme sources and `file://` is the one scheme where browsers
 * apply those inconsistently — a CSP pass here would prove nothing.
 */
function startServer(getPage: () => string): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = (req.url ?? '/').split('?')[0] ?? '/';
      if (url === '/__page__') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getPage());
        return;
      }
      const abs = path.join(root, decodeURIComponent(url));
      // Refuse anything that climbed out of the repo, and anything that is not
      // a media or source file — this is a dev tool, not a web server.
      if (!abs.startsWith(root) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(abs)] ?? 'application/octet-stream' });
      res.end(fs.readFileSync(abs));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ port, close: () => server.close() });
    });
  });
}

interface LoadResult {
  /** Wall clock from navigate() to the page's own report line. */
  wallMs: number;
  report: string[];
  /** Browser-level entries: CSP violations surface here, not on the console. */
  logEntries: string[];
  consoleErrors: string[];
}

async function measureLoad(cdp: Cdp, url: string, state: { events: string[]; logs: string[]; errors: string[] }): Promise<LoadResult> {
  state.events.length = 0;
  state.logs.length = 0;
  state.errors.length = 0;

  const t0 = performance.now();
  await cdp.send('Page.navigate', { url });

  await waitFor(`the profile report from ${url}`, () => {
    if (state.events.length === 0) throw new Error('page has not reported yet');
    return Promise.resolve();
  }, REPORT_TIMEOUT_MS);

  return {
    wallMs: performance.now() - t0,
    report: [...state.events],
    logEntries: [...state.logs],
    consoleErrors: [...state.errors],
  };
}

function print(result: LoadResult, label: string): void {
  console.log(`\n${label}`);
  // The report itself is multi-line by design; re-indent it under the label.
  for (const line of result.report) {
    for (const inner of line.split('\n')) console.log(`  ${inner}`);
  }
  console.log(`  ${'navigate → report'.padEnd(26)} ${result.wallMs.toFixed(1)} ms  (wall clock, includes everything)`);
  for (const entry of result.logEntries) console.log(`  [browser] ${entry}`);
  for (const err of result.consoleErrors) console.log(`  [console.error] ${err}`);
}

async function main(): Promise<void> {
  // Built here rather than left to the caller, because the failure mode of
  // forgetting is silent and slow: an instrumented page is the only one that
  // prints a report, so a release build of media/preview.js would sit there
  // until REPORT_TIMEOUT_MS and then blame the browser. Shelling out to the
  // build script — rather than repeating its options here — is what keeps this
  // measuring the bundle the extension actually loads.
  execFileSync(process.execPath, [path.join(root, 'esbuild.ts'), '--profile'], { stdio: 'inherit' });

  await esbuild.build({
    entryPoints: [path.join(root, 'src', 'markdown.ts'), path.join(root, 'src', 'webviewHtml.ts')],
    bundle: true,
    outdir: outDir,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
  });

  const { renderMarkdown } = require(path.join(outDir, 'markdown.js')) as typeof import('../src/markdown');
  const { buildWebviewHtml } = require(path.join(outDir, 'webviewHtml.js')) as typeof import('../src/webviewHtml');

  let page = '';
  const server = await startServer(() => page);
  const origin = `http://127.0.0.1:${server.port}`;

  const chrome = findChrome();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-profile-'));
  const proc = spawn(
    chrome,
    [
      '--headless=new',
      '--remote-debugging-port=0', // 0 = pick a free port; it is written to DevToolsActivePort
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-gpu',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  const cleanup = (): void => {
    proc.kill();
    server.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // best effort; a locked temp dir is not worth failing the run over
    }
  };

  try {
    // Chrome writes the chosen port to DevToolsActivePort once it is listening.
    const portFile = path.join(userDataDir, 'DevToolsActivePort');
    const port = await waitFor('Chrome to open its debugging port', () => {
      if (!fs.existsSync(portFile)) throw new Error('no DevToolsActivePort yet');
      const first = fs.readFileSync(portFile, 'utf8').split('\n')[0];
      if (!first) throw new Error('DevToolsActivePort is empty');
      return Promise.resolve(Number(first));
    });

    const target = await waitFor('a page target', async () => {
      const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{
        type: string;
        webSocketDebuggerUrl?: string;
      }>;
      const found = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (!found?.webSocketDebuggerUrl) throw new Error('no page target with a websocket yet');
      return found.webSocketDebuggerUrl;
    });

    const state = { events: [] as string[], logs: [] as string[], errors: [] as string[] };
    const cdp = await connect(target, (msg) => {
      if (msg.method === 'Runtime.consoleAPICalled') {
        const params = msg.params as { type?: string; args?: Array<{ value?: unknown; description?: unknown }> };
        // Only primitives are stringified. `String(arg)` on an object yields
        // "[object Object]", which would silently turn a console.log of an
        // object into a line that looks like a real message.
        const text = (params.args ?? [])
          .map((a) => {
            const v = a.value ?? a.description;
            return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
          })
          .join(' ');
        if (text.includes(REPORT_PREFIX)) state.events.push(text);
        else if (params.type === 'error') state.errors.push(text);
        return;
      }
      if (msg.method === 'Log.entryAdded') {
        const params = msg.params as { entry?: { level?: string; text?: string } };
        const entry = params.entry;
        if (entry?.text) state.logs.push(`${entry.level ?? '?'}: ${entry.text}`);
      }
    });

    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');

    console.log('graphite.md — webview profiler');
    console.log(`${path.basename(chrome)} (headless) · Node ${process.version}`);

    const docs = [
      { label: 'samples/kitchen-sink.md', source: fs.readFileSync(path.join(root, 'samples', 'kitchen-sink.md'), 'utf8') },
    ];

    for (const doc of docs) {
      const rendered = renderMarkdown(doc.source);
      const built = buildWebviewHtml({
        mediaDir: path.join(root, 'media'),
        toWebviewUri: (absPath) => `${origin}/${path.relative(root, absPath).split(path.sep).join('/')}`,
        cspSource: origin,
        remoteImages: false,
        contentWidth: 60,
        bodyHtml: rendered.html,
        headings: rendered.headings,
        tables: rendered.tables,
        diagrams: rendered.diagrams,
      });

      // `acquireVsCodeApi` is a webview global. The bundle calls it on its first
      // line and would throw without it, so the harness supplies the smallest
      // stub that keeps the file running — getState returning undefined is
      // exactly what a first-ever load returns in a real webview.
      const nonce = /nonce="([^"]+)"/.exec(built)?.[1];
      if (!nonce) throw new Error('the built page has no nonce; the stub cannot be injected');
      const stub = `<script nonce="${nonce}">window.acquireVsCodeApi=function(){return{postMessage:function(){},getState:function(){return undefined},setState:function(){}}};</script>`;
      const firstScriptTag = `<script nonce="${nonce}" src="`;
      if (!built.includes(firstScriptTag)) throw new Error('the built page has no script tag to inject before');

      page = built.replace(firstScriptTag, `${stub}\n${firstScriptTag}`);

      console.log(`\n\n══ ${doc.label} · ${rendered.diagrams.length} diagrams, ${rendered.tables.length} tables, ${rendered.headings.length} headings ══`);

      // Three navigations, not two. The second is the one that would show a
      // saving from a cold browser; the third is what proves the saving has
      // stopped moving — a steady state — rather than still warming. Reporting
      // only the second would let a number that is still falling look like the
      // number a user actually lives with, which is the difference between
      // "reloads are cheaper" and "reloads are THIS expensive".
      const loads: LoadResult[] = [];
      const labels = [
        'load 1 — cold (first navigation in this browser process)',
        'load 2 — reload',
        'load 3 — reload again (steady state)',
      ];
      for (let i = 0; i < 3; i++) {
        const result = await measureLoad(cdp, `${origin}/__page__`, state);
        loads.push(result);
        print(result, labels[i] ?? `load ${i + 1}`);
      }

      const parseAt = (r: LoadResult): number =>
        Number(r.report.join('\n').match(/page → script\s+([\d.]+) ms \(abs\)/)?.[1] ?? NaN);
      const fetchAt = (r: LoadResult, file: string): number =>
        Number(r.report.join('\n').match(new RegExp(`${file}[^\\n]*?([\\d.]+) ms`))?.[1] ?? NaN);

      const [cold, reload, steady] = loads;
      if (cold && reload && steady) {
        console.log('\n  → page → script (HTML parse + mermaid fetch, compile and execute)');
        console.log(`      load 1 (cold)     ${parseAt(cold).toFixed(1)} ms`);
        console.log(`      load 2 (reload)   ${parseAt(reload).toFixed(1)} ms`);
        console.log(`      load 3 (reload)   ${parseAt(steady).toFixed(1)} ms`);

        const settled = Math.abs(parseAt(reload) - parseAt(steady)) < 0.15 * parseAt(steady);
        console.log(
          settled
            ? '      loads 2 and 3 agree, so this is a steady state and not a browser still warming.'
            : '      loads 2 and 3 disagree — still warming; treat the load-3 figure as a ceiling, not the cost.'
        );
        console.log('\n      where the difference between load 1 and load 2 comes from:');
        console.log(`        fetching mermaid.min.js   ${fetchAt(cold, 'mermaid\\.min\\.js').toFixed(1)} ms → ${fetchAt(reload, 'mermaid\\.min\\.js').toFixed(1)} ms   (HTTP cache)`);
        console.log(`        compile + execute it      ${(parseAt(cold) - fetchAt(cold, 'mermaid\\.min\\.js')).toFixed(1)} ms → ${(parseAt(reload) - fetchAt(reload, 'mermaid\\.min\\.js')).toFixed(1)} ms   (code cache)`);
      }
    }

    cdp.close();
  } finally {
    cleanup();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
