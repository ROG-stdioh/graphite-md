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
const pageBundlePath = path.join(root, 'out', 'bdd-page.bundle.js');

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

// The page builder, bundled the same way and for the same reason. It is the
// only place the Content Security Policy exists, and the policy is what makes
// rendering raw HTML safe — so a suite that can only see the renderer can prove
// the markup arrives and nothing about what happens to it once it has.
esbuild.buildSync({
  entryPoints: [path.join(root, 'src', 'webviewHtml.ts')],
  bundle: true,
  outfile: pageBundlePath,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  logLevel: 'silent',
});

// The bundle paths are computed, so the compiler has nothing to resolve; the
// casts name the modules their contents came from.
const { renderMarkdown } = require(bundlePath) as typeof import('../../src/markdown');
const { buildWebviewHtml } = require(pageBundlePath) as typeof import('../../src/webviewHtml');

/**
 * Stands in for the webview the host would hand these to.
 *
 * Not exported, and deliberately: a value export here would make Node read this
 * file as an ES module and `require` would stop existing in it. Everything the
 * steps need from the world comes back through the instance cucumber hands
 * them, and everything they need from the page comes off the page.
 */
const PAGE_STAND_IN = {
  mediaDir: path.join(root, 'media'),
  toWebviewUri: (absPath: string): string =>
    `https://webview.test/${path.relative(path.join(root, 'media'), absPath).split(path.sep).join('/')}`,
  cspSource: 'https://webview.test',
  contentWidth: 60,
  headings: [],
  tables: [],
  diagrams: [],
};

/** One outline node, flattened — see `flatten` below. */
interface FlatNode {
  depth: number;
  label: string;
  target: string;
}

class PreviewWorld extends World {
  source: string;
  result: RenderResult | null;
  /**
   * Stands in for the host's image resolver. The real one lives in
   * extension.ts, where building a URL needs a running VS Code and a live
   * webview; what the suite can hold the renderer to is the contract — that it
   * asks, and that it honours a refusal. The other half, deciding which sources
   * are the host's to resolve at all, is pure logic in src/sourceRef.ts and is
   * exercised directly by the scenarios that call it.
   */
  imageResolver: ((src: string) => string | undefined) | null;
  /** Every source the stand-in resolver was handed, in order. */
  imageRequests: string[];
  /** The source a src/sourceRef.ts scenario is asking about, as written. */
  refSource: string;
  /**
   * Whether the document being reasoned about sits inside a workspace folder.
   *
   * The one fact about the editor that sourceRef.ts's decision needs, and the
   * reason it is a parameter there rather than a `vscode.workspace` lookup: the
   * question "is there a folder to be relative to" is answerable without one.
   */
  docInFolder: boolean;
  /**
   * The `graphiteMd.remoteImages` setting, as the page builder reads it.
   *
   * A field rather than a step argument because it changes which sources the
   * policy admits, and the scenarios that care are about the policy rather than
   * about the document.
   */
  remoteImages: boolean;

  constructor(options: IWorldOptions) {
    super(options);
    this.source = '';
    this.result = null;
    this.imageResolver = null;
    this.imageRequests = [];
    this.refSource = '';
    this.docInFolder = false;
    this.remoteImages = false;
  }

  // Render the document the scenario built up.
  render(): RenderResult {
    this.result = this.imageResolver
      ? renderMarkdown(this.source, { resolveImage: this.imageResolver })
      : renderMarkdown(this.source);
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

  /**
   * The whole page the webview is handed: the rendered document, inside the
   * template that carries the policy.
   *
   * Built from the real `buildWebviewHtml` rather than a copy of it. The policy
   * is the only thing standing between a document's raw HTML and the machine
   * reading it, and a suite that asserted against its own copy of the policy
   * would be checking that copy rather than the one that ships.
   *
   * A fresh page on every call, nonce and all — which is the honest shape of
   * it, since that is what the host does. It also means a step that needs the
   * policy *and* the markup it governs has to call this once and read both off
   * the same string; two calls are two pages, and the nonces will not match.
   */
  buildPage(): string {
    return buildWebviewHtml({
      ...PAGE_STAND_IN,
      remoteImages: this.remoteImages,
      bodyHtml: this.html,
    });
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
