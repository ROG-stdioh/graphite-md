// Copies just what the webview needs out of node_modules, so the extension
// never has to reach a CDN at runtime (which webview CSP blocks anyway).
//
// - KaTeX: only CSS + font files. Math itself is rendered to static HTML at
//   build/edit time in the extension host (see src/markdown.ts), so we do
//   NOT need katex.min.js or auto-render.min.js in the webview at all.
// - Mermaid: needs a real DOM to lay diagrams out, so it stays client-side —
//   we ship its single bundled file and run it inside the webview.

const fs = require('fs');
const path = require('path');

function copyDir(src, dest) {
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

const root = path.join(__dirname, '..');
const katexDist = path.join(root, 'node_modules/katex/dist');
const mermaidDist = path.join(root, 'node_modules/mermaid/dist');
const vendorDir = path.join(root, 'media/vendor');

fs.mkdirSync(path.join(vendorDir, 'katex'), { recursive: true });

copyDir(path.join(katexDist, 'fonts'), path.join(vendorDir, 'katex/fonts'));
fs.copyFileSync(path.join(katexDist, 'katex.min.css'), path.join(vendorDir, 'katex/katex.min.css'));

fs.copyFileSync(path.join(mermaidDist, 'mermaid.min.js'), path.join(vendorDir, 'mermaid.min.js'));

console.log('Vendor assets copied to media/vendor/');
