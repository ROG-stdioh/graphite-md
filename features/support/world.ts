// The shared world every scenario runs against.
//
// The steps drive the real renderer — src/markdown.ts, bundled exactly the way
// the extension bundles it — rather than a reimplementation or a mock. A suite
// that tests a second copy of the logic only proves the copy agrees with
// itself.
//
// `require` rather than `import` keeps this file CommonJS, which is what lets
// Cucumber load it; the casts reattach the module types @types/node widens to
// `any`. See esbuild.ts for the full note. Types still cross the boundary
// because `import type` is erased before Node decides a file's module format —
// so the types are derived from their real definitions even though the values
// cannot be imported.
import type { IWorldOptions } from '@cucumber/cucumber';
import type { RenderResult } from '../../src/markdown';
// TocNode is the shared contract's type, not the renderer's — src/markdown.ts
// imports it from there too, and deliberately does not re-export it. Naming it
// from its real home is what keeps the outline shape single-sourced across the
// renderer, the host, the webview and this suite.
import type { TocNode } from '../../src/shared/protocol';

const path = require('path') as typeof import('path');
const esbuild = require('esbuild') as typeof import('esbuild');
const { setWorldConstructor, World } = require('@cucumber/cucumber') as typeof import('@cucumber/cucumber');

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

// The bundle path is computed, so the compiler has nothing to resolve; the cast
// names the module its contents came from.
const { renderMarkdown } = require(bundlePath) as typeof import('../../src/markdown');

/** One outline node, flattened — see `flatten` below. */
interface FlatNode {
  depth: number;
  label: string;
  target: string;
}

class PreviewWorld extends World {
  source: string;
  result: RenderResult | null;

  constructor(options: IWorldOptions) {
    super(options);
    this.source = '';
    this.result = null;
  }

  // Render the document the scenario built up.
  render(): RenderResult {
    this.result = renderMarkdown(this.source);
    return this.result;
  }

  get html(): string {
    return this.result ? this.result.html : '';
  }

  // The outline's three views, as the preview's right-hand pane shows them.
  get content(): TocNode[] {
    return this.result ? this.result.headings : [];
  }

  get tables(): TocNode[] {
    return this.result ? this.result.tables : [];
  }

  get diagrams(): TocNode[] {
    return this.result ? this.result.diagrams : [];
  }
}

setWorldConstructor(PreviewWorld);

// Flatten the outline tree into [depth, label] pairs, depth-first, so a
// scenario can assert the whole shape of the document in one table.
function flatten(nodes: readonly TocNode[], depth = 0, out: FlatNode[] = []): FlatNode[] {
  for (const node of nodes) {
    out.push({ depth, label: node.label, target: node.target });
    if (node.children?.length) flatten(node.children, depth + 1, out);
  }
  return out;
}

module.exports = { PreviewWorld, flatten, root };

// The step files need the world's shape to type `this`, and `module.exports`
// above is invisible to the compiler — TypeScript does not infer a module's
// exports from that assignment. This is the other half, and it is type-only, so
// the type stripper erases it and the file stays CommonJS.
export type { PreviewWorld, FlatNode };
