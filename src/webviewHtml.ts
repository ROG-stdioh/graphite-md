/**
 * The page the webview loads, as a string.
 *
 * Pure, in the same sense src/markdown.ts is: no `vscode` import, no
 * configuration lookup, no extension path of its own. The two things the page
 * cannot know — where the media directory is, and how one of its paths becomes
 * a URL the webview may load — arrive as arguments. That split is what lets
 * scripts/media-version-check.ts build the real page and assert on it without
 * an editor, the way src/sourceRef.ts splits the decision from the doing for
 * image sources.
 */
import * as path from 'path';
import { contentVersion } from './mediaVersion';
import type { PreviewData, TocNode } from './shared/protocol';

export interface WebviewHtmlOptions {
  /** Absolute path of the extension's own `media` directory. */
  mediaDir: string;
  /** Turns an absolute path into a URL the webview is allowed to load. */
  toWebviewUri: (absPath: string) => string;
  /** `webview.cspSource` — the origin the webview serves its own assets from. */
  cspSource: string;
  /** Whether the `graphiteMd.remoteImages` setting is on. */
  remoteImages: boolean;
  contentWidth: number;
  bodyHtml: string;
  headings: TocNode[];
  tables: TocNode[];
  diagrams: TocNode[];
}

export function buildWebviewHtml(options: WebviewHtmlOptions): string {
  // Every media URL in the template below is built here, and that is the point:
  // the version is not a step a caller can forget, because there is no way to
  // name a media file in this page that does not come through this function.
  // Adding a fifth script is stamped by construction — which is the property
  // the hand-maintained constant never had.
  //
  // One version per file rather than one for the set, because that is how they
  // are cached: preview.css and preview.js are separate entries, and a change
  // to one has no business refetching the other.
  const mediaUrl = (relPath: string): string => {
    const absPath = path.join(options.mediaDir, relPath);
    return `${options.toWebviewUri(absPath)}?v=${contentVersion(absPath)}`;
  };

  // One nonce for the page, shared by the CSP and the three script tags that
  // carry it. A second call would generate a different value and the page's own
  // scripts would be blocked.
  const nonce = getNonce();

  // `https:` is admitted only when the user has asked for it. It is the single
  // directive that lets a document reach the network, so it is added by the
  // setting rather than being present and then narrowed — a policy that starts
  // closed is the one that cannot be left ajar by a later edit.
  //
  // `media-src` takes the same shape as `img-src` and for the same reason: a
  // `<video>` or `<audio>` written in raw HTML is a source out of the document
  // exactly as a picture is, so it crosses the same boundary and answers to the
  // same setting. Without the directive, `default-src 'none'` refuses it, and
  // VS Code — which admits media — plays the same file.
  const mediaSrc = options.remoteImages
    ? `media-src ${options.cspSource} data: https:`
    : `media-src ${options.cspSource} data:`;
  const imgSrc = options.remoteImages
    ? `img-src ${options.cspSource} data: https:`
    : `img-src ${options.cspSource} data:`;
  const csp = [
    `default-src 'none'`,
    imgSrc,
    mediaSrc,
    `style-src ${options.cspSource} 'unsafe-inline'`,
    `font-src ${options.cspSource}`,
    // Nonce, and only a nonce. There is no `'unsafe-inline'` here and there
    // must never be one: with raw HTML rendering, an inline `<script>` or an
    // `onclick=` attribute is markup an author can now write, and this
    // directive is the entire reason that is safe to allow. The two scripts the
    // page does run — mermaid and preview.js — carry the nonce.
    `script-src 'nonce-${nonce}'`,
    // `form-action` is not one of the directives that falls back to
    // `default-src`, so `default-src 'none'` alone would leave a `<form>` in a
    // document free to post wherever its `action` points. VS Code relies on
    // `enableForms: false` for this, which the host now sets too — this is the
    // half the suite can hold, since panel options need a running editor to
    // observe and this string does not.
    `form-action 'none'`,
  ].join('; ');

  const initialData: PreviewData = {
    headings: options.headings,
    tables: options.tables,
    diagrams: options.diagrams,
  };

  // The KaTeX stylesheet is the one media file whose own dependencies are not
  // versioned here: its 60 `url(fonts/…)` references resolve against the
  // stylesheet's URL but do not inherit its query string, so a `?v=` on this
  // link would leave every font file cached under its old name.
  // scripts/copy-assets.ts bakes a version of the font set into the copied CSS
  // instead, which is what closes that loop — see its comment for the chain.
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${mediaUrl('vendor/katex/katex.min.css')}">
<link rel="stylesheet" href="${mediaUrl('preview.css')}">
</head>
<body style="--content-width:${options.contentWidth}%">
  <div class="shell">
    <div class="content-pane-wrap scroll-wrap">
      <div class="scroll-body content-pane" id="contentPane" data-scroll>
        <div class="content-inner" id="contentInner">
          ${options.bodyHtml}
        </div>
      </div>
      <div class="scroll-track"><div class="scroll-thumb"></div></div>
    </div>

    <div class="toc-pane-wrap scroll-wrap">
      <div class="scroll-body toc-pane" data-scroll>
        <div class="pane-label">On this page</div>
        <div class="accordion-section">
          <button class="accordion-header expanded" data-view="content"><span class="chev">▾</span>Content</button>
          <div class="graph" id="graphContent"></div>
        </div>
        <div class="accordion-section">
          <button class="accordion-header" data-view="tables"><span class="chev">▾</span>Tables</button>
          <div class="graph collapsed" id="graphTables"></div>
        </div>
        <div class="accordion-section">
          <button class="accordion-header" data-view="diagrams"><span class="chev">▾</span>Diagrams</button>
          <div class="graph collapsed" id="graphDiagrams"></div>
        </div>
      </div>
      <div class="scroll-track"><div class="scroll-thumb"></div></div>
    </div>
  </div>

  <script nonce="${nonce}">window.__PREVIEW_DATA__ = ${JSON.stringify(initialData)};</script>
  <script nonce="${nonce}" src="${mediaUrl('vendor/mermaid.min.js')}"></script>
  <script nonce="${nonce}" src="${mediaUrl('preview.js')}"></script>
</body>
</html>`;
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}
