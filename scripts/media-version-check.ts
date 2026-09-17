// Asserts that every file the preview page loads is requested at a URL that
// changes when that file does.
//
// The failure this covers has no symptom inside the editor. VS Code's webview
// serves a cached copy of an asset across panel reopens, so an extension that
// ships new code can go on running the previous release's code — silently, for
// the users who upgraded, which is the worst audience available to fail. No
// check here can see VS Code's cache. It can see the URL, and a URL carrying
// the file's own content version cannot go stale.
//
// It replaces a constant in the HTML template that had to be bumped by hand and
// was forgotten twice, once per release that touched a media file. There is
// nothing left to forget, and this is what says so.
//
// Bundles src/webviewHtml.ts rather than importing it, the way
// scripts/render-check.ts bundles the renderer: the page under test has to be
// built by the module the extension builds it with.
//
// Needs `npm run build` first for the KaTeX half — media/vendor/ is copied out
// of node_modules, not committed. Run: node scripts/media-version-check.ts
//
// `require` rather than `import` keeps this file CommonJS, which is what lets
// Node run it directly; the cast reattaches the module type @types/node widens
// to `any`. See esbuild.ts for the full note.
const esbuild = require('esbuild') as typeof import('esbuild');
const crypto = require('crypto') as typeof import('crypto');
const fs = require('fs') as typeof import('fs');
const os = require('os') as typeof import('os');
const path = require('path') as typeof import('path');

const root = path.join(__dirname, '..');
const bundle = path.join(root, 'out', 'webview-html.bundle.js');
const mediaDir = path.join(root, 'media');

// Every file the page loads. Kept as a list rather than derived, because the
// per-file assertion below — that each URL carries the version of the file it
// names, and not some other file's — needs to know which file each one is. A
// fifth media file therefore fails the count check until it is named here,
// which is the point: it is the moment someone has to say what the page loads.
const LOADED = ['preview.css', 'preview.js', 'vendor/katex/katex.min.css', 'vendor/mermaid.min.js'];

async function main(): Promise<void> {
  await esbuild.build({
    entryPoints: [path.join(root, 'src', 'webviewHtml.ts')],
    bundle: true,
    outfile: bundle,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
  });

  // The bundle path is computed, so there is nothing for the compiler to
  // resolve; the cast names the module its contents came from.
  const { buildWebviewHtml } = require(bundle) as typeof import('../src/webviewHtml');

  let failures = 0;
  const check = (name: string, cond: boolean, detail?: string): void => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
    if (!cond) {
      failures++;
      if (detail) console.log(`      ${detail}`);
    }
  };

  // The stand-in URI keeps the path it was handed, so the assertions can see
  // which file each URL names without an editor in the room.
  const build = (dir: string): { html: string; asked: string[] } => {
    const asked: string[] = [];
    const html = buildWebviewHtml({
      mediaDir: dir,
      toWebviewUri: (absPath) => {
        const rel = path.relative(dir, absPath).split(path.sep).join('/');
        asked.push(rel);
        return `https://webview.test/${rel}`;
      },
      cspSource: 'https://webview.test',
      remoteImages: false,
      contentWidth: 60,
      bodyHtml: '<p>body</p>',
      headings: [],
      tables: [],
      diagrams: [],
    });
    return { html, asked };
  };

  // Computed here, independently of the module under test, so this is a
  // comparison rather than the module agreeing with itself.
  const digestOf = (absPath: string): string =>
    crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex').slice(0, 12);

  const versionOf = (html: string, file: string): string =>
    new RegExp(`https://webview\\.test/${file.replace(/\./g, '\\.')}\\?v=([^"&]*)`).exec(html)?.[1] ?? '';

  // ---- the page, against the real media directory ---------------------------
  const real = build(mediaDir);

  check(
    `the page loads exactly the ${LOADED.length} expected media files`,
    real.asked.length === LOADED.length && LOADED.every((f) => real.asked.includes(f)),
    `asked for: ${real.asked.join(', ')} — if a media file was added, name it in LOADED`
  );

  for (const file of LOADED) {
    const absPath = path.join(mediaDir, file);
    if (!fs.existsSync(absPath)) {
      check(`${file} is versioned by its own contents`, false, 'missing — run `npm run build` first');
      continue;
    }
    check(
      `${file} is versioned by its own contents`,
      versionOf(real.html, file) === digestOf(absPath),
      `page says "${versionOf(real.html, file)}", file hashes to "${digestOf(absPath)}"`
    );
  }

  // The check the four above cannot make: a *fifth* file added to the template
  // without going through the versioning helper would not appear in `asked` and
  // has no entry in LOADED — but it would still be a URL in the page.
  const urls = [...real.html.matchAll(/(?:href|src)="([^"]*)"/g)].map((m) => m[1] ?? '');
  check(
    `every URL in the page carries a version (${urls.length} found)`,
    urls.length > 0 && urls.every((u) => u.includes('?v=')),
    `unversioned: ${urls.filter((u) => !u.includes('?v=')).join(', ')}`
  );

  // ---- a version that follows the file, not the path ------------------------
  // Driven through the same builder on purpose: a version cached on the path
  // alone would return the stale value on the rewrite below and still pass
  // every check above.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'graphite-md-media-'));
  try {
    for (const file of LOADED) {
      const dest = path.join(scratch, file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(mediaDir, file), dest);
    }

    const copied = build(scratch);
    check(
      'the same bytes version the same wherever they sit',
      // Per file, not the whole document: the page carries a fresh nonce on
      // every build, so two builds of it are never equal — and the nonce says
      // nothing about versions either way.
      LOADED.every((f) => versionOf(copied.html, f) === versionOf(real.html, f)),
      'the version is meant to be derived from the contents, not from the path'
    );

    // A different length, so this holds on a filesystem whose timestamps are
    // too coarse to separate two writes inside one tick — the size is the
    // signal that survives everywhere.
    const target = path.join(scratch, 'preview.js');
    fs.appendFileSync(target, '\n// changed\n');
    const rewritten = build(scratch);
    check(
      'rewriting one file re-versions that file',
      versionOf(rewritten.html, 'preview.js') === digestOf(target) &&
        versionOf(rewritten.html, 'preview.js') !== versionOf(real.html, 'preview.js'),
      'a version that did not move would serve the previous bundle to everyone who upgrades'
    );
    check(
      '...and leaves the other three where they were',
      LOADED.filter((f) => f !== 'preview.js').every(
        (f) => versionOf(rewritten.html, f) === versionOf(real.html, f)
      ),
      'a change to one file must not refetch the rest'
    );

    fs.rmSync(path.join(scratch, 'preview.css'));
    const missing = build(scratch);
    check(
      'a media file that cannot be read does not break the page',
      missing.html.includes('preview.css?v=0') &&
        // Against the tree as it stood a moment ago, not `real`: preview.js
        // was rewritten above, so `real` is no longer this tree's baseline.
        LOADED.filter((f) => f !== 'preview.css').every(
          (f) => versionOf(missing.html, f) === versionOf(rewritten.html, f)
        ),
      'the HTML is built outside the try/catch that renders the error page, so a throw here is a blank panel'
    );
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  // ---- the files a stylesheet's query string cannot reach --------------------
  // KaTeX's own `url(fonts/…)` references resolve against the stylesheet but do
  // not inherit its query string, so this is the half the page-level versioning
  // cannot cover. scripts/copy-assets.ts rewrites them; this is what notices if
  // that stops happening.
  const katexCss = path.join(mediaDir, 'vendor/katex/katex.min.css');
  if (!fs.existsSync(katexCss)) {
    check('KaTeX font URLs are versioned', false, 'missing — run `npm run build` first');
  } else {
    const css = fs.readFileSync(katexCss, 'utf8');
    const fontUrls = [...css.matchAll(/url\(fonts\/([^)]*)\)/g)].map((m) => m[1] ?? '');
    check(
      `KaTeX font URLs are versioned (${fontUrls.length} found)`,
      // The count matters as much as the assertion: if KaTeX ever changes how
      // its CSS spells these paths the pattern matches nothing, and a
      // vacuously-true check is worse than no check.
      fontUrls.length > 0 && fontUrls.every((u) => /\?v=[0-9a-f]{12}$/.test(u)),
      fontUrls.filter((u) => !/\?v=[0-9a-f]{12}$/.test(u)).slice(0, 3).join(', ')
    );
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
