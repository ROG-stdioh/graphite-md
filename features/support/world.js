// The shared world every scenario runs against.
//
// The steps drive the real renderer — src/markdown.ts, bundled exactly the way
// the extension bundles it — rather than a reimplementation or a mock. A suite
// that tests a second copy of the logic only proves the copy agrees with
// itself.
const path = require('path');
const esbuild = require('esbuild');
const { setWorldConstructor, World } = require('@cucumber/cucumber');

const root = path.join(__dirname, '..', '..');
const bundlePath = path.join(root, 'out', 'bdd.bundle.js');

// Rebuilt on every run, never reused from disk. A cached bundle would let the
// suite pass against the previous version of the source, which is the one
// thing a test run must never do.
esbuild.buildSync({
  entryPoints: [path.join(root, 'src', 'markdown.ts')],
  bundle: true,
  outfile: bundlePath,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  logLevel: 'silent',
});

const { renderMarkdown } = require(bundlePath);

class PreviewWorld extends World {
  constructor(options) {
    super(options);
    this.source = '';
    this.result = null;
  }

  // Render the document the scenario built up.
  render() {
    this.result = renderMarkdown(this.source);
    return this.result;
  }

  get html() {
    return this.result ? this.result.html : '';
  }

  // The outline's three views, as the preview's right-hand pane shows them.
  get content() {
    return this.result ? this.result.headings : [];
  }

  get tables() {
    return this.result ? this.result.tables : [];
  }

  get diagrams() {
    return this.result ? this.result.diagrams : [];
  }
}

setWorldConstructor(PreviewWorld);

// Flatten the outline tree into [depth, label] pairs, depth-first, so a
// scenario can assert the whole shape of the document in one table.
function flatten(nodes, depth = 0, out = []) {
  for (const node of nodes) {
    out.push({ depth, label: node.label, target: node.target });
    if (node.children && node.children.length) flatten(node.children, depth + 1, out);
  }
  return out;
}

module.exports = { PreviewWorld, flatten, root };
