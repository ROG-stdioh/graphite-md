// Copies just what the webview needs out of node_modules, so the extension
// never has to reach a CDN at runtime (which webview CSP blocks anyway).
//
// - KaTeX: only CSS + font files. Math itself is rendered to static HTML at
//   build/edit time in the extension host (see src/markdown.ts), so we do
//   NOT need katex.min.js or auto-render.min.js in the webview at all.
// - Mermaid: needs a real DOM to lay diagrams out, so it stays client-side —
//   we ship its single bundled file and run it inside the webview.
//
// The copied KaTeX CSS is deliberately not byte-identical to the one in
// node_modules: its font URLs carry a version, which is the only way those 60
// files can be cache-busted at all. See fontSetVersion below.
//
// `require` rather than `import` keeps this file CommonJS, which is what lets
// Node run it directly; the cast reattaches the module type @types/node widens
// to `any`. See esbuild.ts for the full note.
const crypto = require('crypto') as typeof import('crypto');
const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

/**
 * One version for the whole KaTeX font set, derived from the font files.
 *
 * A stylesheet's query string does not reach the URLs written inside it:
 * `url(fonts/X)` in `katex.min.css?v=abc` still resolves to `fonts/X`, which
 * carries no query string of its own and is served from the webview's cache
 * like any other asset. So the `?v=` the page puts on this stylesheet covers
 * the CSS and nothing else — all 60 font files would stay stale, and a stale
 * font does not fail loudly, it renders the wrong glyph.
 *
 * Baking the version into the copied CSS is what closes that. Note the chain:
 * a changed font changes these URLs, which changes the CSS's bytes, which
 * changes the version the HTML template computes for the CSS — so the one
 * `?v=` on the `<link>` is enough to reach all 61 files, and nothing here
 * needs to be known by the page builder.
 *
 * The whole set rather than per-file versions: the files arrive together from
 * one KaTeX version, so they are one unit to cache and one number to read.
 */
function fontSetVersion(fontsDir: string): string {
  const hash = crypto.createHash('sha256');
  const names = fs
    .readdirSync(fontsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    // The name matters as much as the bytes: two fonts with identical contents
    // are still two different files, and a rename is a change worth busting.
    hash.update(name);
    hash.update(fs.readFileSync(path.join(fontsDir, name)));
  }
  return hash.digest('hex').slice(0, 12);
}

const root = path.join(__dirname, '..');
const katexDist = path.join(root, 'node_modules/katex/dist');
const mermaidDist = path.join(root, 'node_modules/mermaid/dist');
const vendorDir = path.join(root, 'media/vendor');

fs.mkdirSync(path.join(vendorDir, 'katex'), { recursive: true });

const katexFonts = path.join(katexDist, 'fonts');
const fontVersion = fontSetVersion(katexFonts);
copyDir(katexFonts, path.join(vendorDir, 'katex/fonts'));

// A function replacement, not a string: `$` in a captured filename would be
// read as a substitution pattern in a replacement string.
// A function replacement, not a string: `$` in a captured filename would be
// read as a substitution pattern in a replacement string.
const katexCss = fs
  .readFileSync(path.join(katexDist, 'katex.min.css'), 'utf8')
  .replace(/url\(fonts\/([^)]+)\)/g, (_match: string, file: string) => `url(fonts/${file}?v=${fontVersion})`);
fs.writeFileSync(path.join(vendorDir, 'katex/katex.min.css'), katexCss);

fs.copyFileSync(path.join(mermaidDist, 'mermaid.min.js'), path.join(vendorDir, 'mermaid.min.js'));

console.log(`Vendor assets copied to media/vendor/ (KaTeX fonts at ${fontVersion})`);
