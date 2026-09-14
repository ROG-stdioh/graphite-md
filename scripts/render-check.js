// Dev-only sanity check for the markdown pipeline: bundles src/markdown.ts
// with esbuild and runs it over test.md / test2.md, asserting on the HTML
// output. Not part of the extension build (which only bundles extension.ts).
// Run: node scripts/render-check.js
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const bundle = path.join(root, 'out', 'render-check.bundle.js');

async function main() {
  await esbuild.build({
    entryPoints: [path.join(root, 'src', 'markdown.ts')],
    bundle: true,
    outfile: bundle,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
  });
  const { renderMarkdown } = require(bundle);

  let failures = 0;
  const check = (name, cond) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
    if (!cond) failures++;
  };

  const test2 = fs.readFileSync(path.join(root, '..', 'test2.md'), 'utf8');
  const r2 = renderMarkdown(test2);
  const html2 = r2.html;

  check('sup: mc<sup>2</sup> (^2^ syntax)', /mc<sup>2<\/sup>/.test(html2));
  check('sub: H<sub>2</sub>O (~2~ syntax)', /H<sub>2<\/sub>O/.test(html2));
  check('ins: <ins>underlined</ins> (++ syntax)', /<ins>underlined<\/ins>/.test(html2));
  check('mark: <mark> (== syntax)', /<mark>marked\/highlighted text<\/mark>/.test(html2));
  check('strikethrough <s>', /<s>strikethrough<\/s>/.test(html2));
  check('footnotes section rendered', /class="footnotes"/.test(html2) && /text contents of the footnote/.test(html2));
  check('footnote ref anchors (forward + backref)', /href="#fn1" id="fnref1"/.test(html2) && /href="#fnref1" class="footnote-backref"/.test(html2));
  check('syntax highlighting (hljs spans)', /hljs-keyword/.test(html2) && /hljs-string/.test(html2));
  check('plain fence has no hljs spans', (() => {
    const blocks = html2.match(/<pre[\s\S]*?<\/pre>/g) || [];
    const plain = blocks.find((b) => b.includes('npm install'));
    return !!plain && !/<span class="hljs-/.test(plain);
  })());
  check('mermaid blocks (both diagrams)', /class="mermaid" id="diagram-1"/.test(html2) && /class="mermaid" id="diagram-2"/.test(html2));
  check('inline math via katex', /<span class="katex">/.test(html2));
  check('display math via katex-display', /katex-display/.test(html2));
  check('HTML comments stripped', !html2.includes('&lt;!--'));
  check('quote-nested heading NOT in outline', !r2.headings.some((h) => h.label.includes('Markdown Inside Quotes')));
  check('outline nests H2 -> H6 (depth 4)', (() => {
    const h2 = r2.headings.find((h) => h.label.startsWith('H2: Section'));
    const h3 = h2 && h2.children && h2.children[0];
    const h4 = h3 && h3.children && h3.children[0];
    const h5 = h4 && h4.children && h4.children[0];
    const h6 = h5 && h5.children && h5.children[0];
    return !!h6 && h6.label.startsWith('H6:');
  })());
  check('outline has multiple roots', r2.headings.length >= 6);
  check('tables collected (1 table)', r2.tables.length === 1);
  check('diagrams collected (2)', r2.diagrams.length === 2);
  check('task checkboxes with source lines', /task-checkbox/.test(html2) && /data-line="\d+"/.test(html2));

  for (const tag of ['div', 'section', 'blockquote', 'ul', 'ol', 'table', 'pre', 'p', 'li', 'sup', 'sub', 'mark', 'ins', 'span']) {
    const open = (html2.match(new RegExp(`<${tag}(\\s|>)`, 'g')) || []).length;
    const close = (html2.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    check(`tag balance <${tag}> (${open} open / ${close} close)`, open === close);
  }

  const test1 = fs.readFileSync(path.join(root, '..', 'test.md'), 'utf8');
  const r1 = renderMarkdown(test1);
  check('test.md renders without throwing', r1.html.length > 1000);
  check('test.md headings all top-level-structure', !r1.headings.some((h) => h.label === ''));

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
