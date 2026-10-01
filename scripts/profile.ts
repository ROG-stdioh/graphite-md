// Dev-only profiler for the half of the cost that can be measured without an
// editor: the host pipeline, and the media the webview is handed on every load.
// Run: npm run profile
//
// It is deliberately NOT the whole answer. What a keystroke costs the *webview*
// cannot be measured from Node — that needs a real browser context with a real
// style engine and a real mermaid — and is measured instead by the
// instrumentation in src/webview/main.ts with `npm run watch:profile` (see
// DEVELOPMENT.md). This script's job is the other half, plus the arithmetic
// that shows which half matters.
//
// `require` rather than `import` keeps this file CommonJS, which is what lets
// Node run it directly; the cast reattaches the module type @types/node widens
// to `any`. See esbuild.ts for the full note.
const esbuild = require('esbuild') as typeof import('esbuild');
const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');
const vm = require('vm') as typeof import('vm');

const root = path.join(__dirname, '..');
const sampleDir = path.join(root, 'samples');
const mediaDir = path.join(root, 'media');
const outDir = path.join(root, 'out', 'profile');

/** Lines in the synthetic document, which stands in for the large real ones. */
const LARGE_DOC_LINES = 3700;

/**
 * Median of three runs.
 *
 * Three rather than one because a single reading on this machine moves by
 * tens of percent between runs, and a before/after comparison built on noise
 * proves nothing. Median of three on an odd count is the middle value, so no
 * averaging hides a bimodal result.
 *
 * Right for the render pipeline, whose cost is JIT-warmed work in a long-lived
 * process. Wrong for anything V8 *caches by content* — see coldRun.
 */
function median3(run: () => void): number {
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    run();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[1] ?? 0;
}

/**
 * The first run's time, and only the first.
 *
 * V8 caches compilation by source string: compiling the same bytes a second
 * time in the same process measured 0.06 ms against 93.7 ms cold. A median over
 * three runs therefore reports the *cache*, not the cost — which is exactly the
 * mistake this script made on its first run, printing "0.1 ms" for a 3.18 MB
 * bundle.
 *
 * The cache is also why the live measurement exists rather than being a
 * nicety. Whether the webview pays the cold price on a reload is a question
 * about Chromium's own code cache, and no Node measurement can answer it: the
 * instrumentation in src/webview/main.ts can, because it runs in the thing
 * being asked about.
 */
function coldRun(run: () => void): number {
  const t0 = performance.now();
  run();
  return performance.now() - t0;
}

function pad(value: string, width: number): string {
  return value.padEnd(width);
}

function padStart(value: string, width: number): string {
  return value.padStart(width);
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * A document of the size the perf complaint is actually about.
 *
 * Built by repeating a real sample rather than by generating filler, so the
 * renderer meets the same mix of tables, code, math and diagrams it meets in a
 * real long document — a synthetic document of only paragraphs would measure
 * the cheapest possible case and flatter the result.
 */
function largeDocument(): string {
  const unit = fs.readFileSync(path.join(sampleDir, 'rfc-014-shard-rebalancing.md'), 'utf8');
  const parts: string[] = ['# Large synthetic document\n'];
  while (parts.join('\n').split('\n').length < LARGE_DOC_LINES) parts.push(unit);
  return parts.join('\n');
}

interface DocResult {
  name: string;
  lines: number;
  chars: number;
  renderMs: number;
  htmlMs: number;
}

async function main(): Promise<void> {
  // Both modules in one build, each as its own file. Bundled rather than
  // imported so the profile measures the same code the extension runs — a
  // TypeScript path through Node's own loader would be a different program.
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

  console.log('graphite.md — profiler');
  console.log(`${process.platform} ${process.arch} · Node ${process.version} · V8 ${process.versions.v8}`);
  console.log('\nEvery number below is this machine\'s and nobody else\'s. The shape of the cost —\nwhich stage dominates — is what transfers to a slower one; the milliseconds do not.');

  // ---- host pipeline --------------------------------------------------------
  const large = largeDocument();
  const docs: Array<{ name: string; source: string }> = [
    ...fs
      .readdirSync(sampleDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => ({ name: `samples/${f}`, source: fs.readFileSync(path.join(sampleDir, f), 'utf8') })),
    { name: '…synthetic large', source: large },
  ];

  const results: DocResult[] = [];
  for (const doc of docs) {
    const renderMs = median3(() => {
      renderMarkdown(doc.source);
    });
    const rendered = renderMarkdown(doc.source);
    const htmlMs = median3(() => {
      buildWebviewHtml({
        mediaDir,
        toWebviewUri: (absPath) => `vscode-resource://${absPath.replace(/\\/g, '/')}`,
        cspSource: 'vscode-webview://profile',
        remoteImages: false,
        contentWidth: 60,
        bodyHtml: rendered.html,
        headings: rendered.headings,
        tables: rendered.tables,
        diagrams: rendered.diagrams,
      });
    });
    results.push({
      name: doc.name,
      lines: doc.source.split('\n').length,
      chars: doc.source.length,
      renderMs,
      htmlMs,
    });
  }

  console.log('\n── host pipeline, per render (median of 3) ' + '─'.repeat(24));
  console.log(
    `  ${pad('document', 46)}${padStart('lines', 8)}${padStart('chars', 9)}${padStart('render', 12)}${padStart('html', 10)}${padStart('total', 11)}`
  );
  for (const r of results) {
    console.log(
      `  ${pad(r.name, 46)}${padStart(String(r.lines), 8)}${padStart(String(r.chars), 9)}${padStart(`${r.renderMs.toFixed(2)} ms`, 12)}${padStart(`${r.htmlMs.toFixed(2)} ms`, 10)}${padStart(`${(r.renderMs + r.htmlMs).toFixed(2)} ms`, 11)}`
    );
  }

  // ---- the media the webview loads -----------------------------------------
  const scripts = [
    'vendor/mermaid.min.js',
    'preview.js',
    'preview.css',
    'vendor/katex/katex.min.css',
  ];

  console.log('\n── media the webview loads on every reload ' + '─'.repeat(22));
  console.log(`  ${pad('file', 30)}${padStart('size', 12)}${padStart('V8 parse (cold)', 20)}`);
  for (const rel of scripts) {
    const abs = path.join(mediaDir, rel);
    if (!fs.existsSync(abs)) {
      console.log(`  ${pad(rel, 30)}${padStart('(missing)', 12)}`);
      continue;
    }
    const size = fs.statSync(abs).size;
    // Only scripts are parsed. A stylesheet is the style engine's problem and
    // there is no equivalent measurement of it available here — saying so beats
    // printing a zero that reads like "free".
    const parse = rel.endsWith('.js')
      ? (() => {
          const src = fs.readFileSync(abs, 'utf8');
          return `${coldRun(() => {
            new vm.Script(src, { filename: rel });
          }).toFixed(1)} ms`;
        })()
      : 'n/a (stylesheet)';
    console.log(`  ${pad(rel, 30)}${padStart(mb(size), 12)}${padStart(parse, 20)}`);
  }

  // ---- the arithmetic that decides where to work ---------------------------
  const largest = results[results.length - 1];
  console.log('\n── what one keystroke costs, on the largest document ' + '─'.repeat(19));
  if (largest) {
    console.log(`  host       ${(largest.renderMs + largest.htmlMs).toFixed(2)} ms  (renderMarkdown + buildWebviewHtml)`);
  }
  console.log('  webview    not measurable from here — run `npm run watch:profile` and read the');
  console.log('             webview DevTools console (see DEVELOPMENT.md)');
  console.log('\n  Two caveats on the parse column, both in opposite directions:');
  console.log('    · LOWER bound — `new vm.Script` compiles top-level code and leaves function');
  console.log('      bodies lazy; mermaid.run() then compiles a great many of them on first call.');
  console.log('      `new Function(src)` on the same bundle measures ~98 ms against ~94 ms here.');
  console.log('    · UPPER bound for a *reload* — V8 caches compilation by source string, so');
  console.log('      re-compiling identical bytes in one process cost 0.06 ms. Whether Chromium\'s');
  console.log('      own code cache survives a webview reload is what the live run settles.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
