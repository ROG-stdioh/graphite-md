// Dev-only sanity check for the markdown pipeline: bundles src/markdown.ts
// with esbuild and runs it over samples/kitchen-sink.md, asserting on the HTML
// output. Not part of the extension build (which only bundles extension.ts).
// Run: node scripts/render-check.js
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const bundle = path.join(root, 'out', 'render-check.bundle.js');
const sample = path.join(root, 'samples', 'kitchen-sink.md');

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

  const src = fs.readFileSync(sample, 'utf8');
  const r = renderMarkdown(src);
  const html = r.html;

  // ---- inline syntax --------------------------------------------------------
  check('sup: mc<sup>2</sup> (^2^ syntax)', /mc<sup>2<\/sup>/.test(html));
  check('sub: H<sub>2</sub>O (~2~ syntax)', /H<sub>2<\/sub>O/.test(html));
  check('ins: <ins> (++ syntax)', /<ins>underline things<\/ins>/.test(html));
  check('mark: <mark> (== syntax)', /<mark>mark them like a highlighter<\/mark>/.test(html));
  check('strikethrough <s>', /<s>strikethrough<\/s>/.test(html));
  check('mark nests inside strong', /<strong><mark>/.test(html) || /<mark><strong>/.test(html));

  // ---- footnotes ------------------------------------------------------------
  check('footnotes section rendered', /class="footnotes"/.test(html) && /text contents of the footnote/.test(html));
  check('footnote ref anchors (forward + backref)', /href="#fn1" id="fnref1"/.test(html) && /href="#fnref1" class="footnote-backref"/.test(html));
  check('footnote re-citation reuses one note', (html.match(/id="fn1"/g) || []).length === 1);

  // ---- code -----------------------------------------------------------------
  check('syntax highlighting (hljs spans)', /hljs-keyword/.test(html) && /hljs-string/.test(html));
  check('plain fence has no hljs spans', (() => {
    const blocks = html.match(/<pre[\s\S]*?<\/pre>/g) || [];
    const plain = blocks.find((b) => b.includes('npm install'));
    return !!plain && !/<span class="hljs-/.test(plain);
  })());
  check('unknown language degrades to plain text', (() => {
    const blocks = html.match(/<pre[\s\S]*?<\/pre>/g) || [];
    const unknown = blocks.find((b) => b.includes('never heard of'));
    return !!unknown && !/hljs/.test(unknown) && /&lt;angle brackets&gt;/.test(unknown);
  })());

  // ---- math and diagrams ----------------------------------------------------
  check('inline math via katex', /<span class="katex">/.test(html));
  check('display math via katex-display', /katex-display/.test(html));
  check('malformed latex does not throw', /katex/.test(html) && html.length > 1000);
  check('mermaid blocks (both diagrams)', /class="mermaid" id="diagram-1"/.test(html) && /class="mermaid" id="diagram-2"/.test(html));

  // ---- structure ------------------------------------------------------------
  check('HTML comments stripped', !html.includes('&lt;!--'));
  check('first H1 extracted as doc title', /<h1 class="doc-title">/.test(html));
  check('second H1 stays in the outline', r.headings.some((h) => h.label.startsWith('A Second Top-Level Heading')));
  check('quote-nested heading NOT in outline', !r.headings.some((h) => h.label.includes('Markdown Inside Quotes')));
  check('outline nests H2 -> H6 (depth 4)', (() => {
    const h2 = r.headings.find((h) => h.label.startsWith('H2: Section'));
    const h3 = h2 && h2.children && h2.children[0];
    const h4 = h3 && h3.children && h3.children[0];
    const h5 = h4 && h4.children && h4.children[0];
    const h6 = h5 && h5.children && h5.children[0];
    return !!h6 && h6.label.startsWith('H6:');
  })());
  check('outline has multiple roots', r.headings.length >= 6);
  check('tables collected (2)', r.tables.length === 2);
  check('diagrams collected (2)', r.diagrams.length === 2);
  check('task checkboxes with source lines', /task-checkbox/.test(html) && /data-line="\d+"/.test(html));
  check('checked + unchecked boxes both emitted', /task-checkbox checked/.test(html) && /class="task-checkbox"/.test(html));

  for (const tag of ['div', 'section', 'blockquote', 'ul', 'ol', 'table', 'pre', 'p', 'li', 'sup', 'sub', 'mark', 'ins', 'span']) {
    const open = (html.match(new RegExp(`<${tag}(\\s|>)`, 'g')) || []).length;
    const close = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    check(`tag balance <${tag}> (${open} open / ${close} close)`, open === close);
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
