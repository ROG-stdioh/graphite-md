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
  /** Whether the `graphiteMd.animation` setting is on — see the body below. */
  animation: boolean;
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

  // One nonce for the page, shared by the CSP and every script tag the page
  // carries, the boot guard below included. A second call would generate a
  // different value and the page's own scripts would be blocked.
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

  // The page holds itself back until it has a size of its own.
  //
  // VS Code hands a panel its document before the panel around it has been laid
  // out, and an iframe that has never been given a size is laid out at the spec
  // default for a replaced element — 300x150. What that produces is not a small
  // preview but a wrong one: the outline is a fixed 300px with `flex-shrink: 0`,
  // so at that viewport it is the entire viewport, the reading pane collapses to
  // nothing, and the page grows a scrollbar. It reads as a rendering fault
  // rather than as a slow load, which is what makes it worth fixing rather than
  // waiting out.
  //
  // Nothing in the page can size the frame it lives in, and the host has nothing
  // to wait for — the panel is already visible when it is created — so the page
  // waits instead. `.booting` hides the shell, and comes off the moment the
  // viewport is anything but that default. That resize is the panel's arrival,
  // and it is the ordinary case. A panel that really is 300x150 sends no resize
  // at all, so `load` is the second way out: a page that has finished loading
  // and still has no size is as sized as it is going to get.
  //
  // The normal case never hides anything. This runs while the head is being
  // parsed — before the body exists, so before anything has been painted — and a
  // page born at its real size, which is what the test editor always produces,
  // takes the class off in the same task it put it on.
  //
  // Inline rather than a file in media/, and it has to stay that way: a script
  // with a `src` is fetched, and a fetched script arrives after the first paint
  // it exists to prevent.
  const bootGuard = `(function () {
  var root = document.documentElement;
  // Chromium's layout, in CSS pixels, for a replaced element never given a size.
  var UNSIZED_W = 300, UNSIZED_H = 150;
  function sized() { return window.innerWidth !== UNSIZED_W || window.innerHeight !== UNSIZED_H; }
  function show() {
    root.classList.remove('booting');
    window.removeEventListener('resize', onResize);
    window.removeEventListener('load', show);
  }
  function onResize() { if (sized()) show(); }
  root.classList.add('booting');
  if (sized()) show();
  else {
    window.addEventListener('resize', onResize);
    window.addEventListener('load', show);
  }
})();`;

  // mermaid is emitted only when the document has a diagram to draw.
  //
  // It is 3.18 MB of JavaScript, and the page parses and executes it on every
  // load — measured on this machine at 164 ms of a 169 ms reload, which makes it
  // the dominant cost of the preview by an order of magnitude. Every document
  // paid it, including the great majority that hold no diagram at all, and no
  // amount of work anywhere else in the page can get that time back. So the tag
  // is simply not there when there is nothing for it to do.
  //
  // The webview is already written for its absence — `window.mermaid` is
  // undefined and the diagram pass is skipped — but an absence is now ambiguous,
  // since it means either "this document has no diagrams" or "this document has
  // diagrams and mermaid failed to load". extension.ts tells them apart from the
  // side that knows which one it built, and the webview reports the second to
  // the Output Channel. That is the whole reason the decision lives here rather
  // than being left to a runtime check in the page.
  const mermaidTag =
    options.diagrams.length === 0
      ? ''
      : `  <script nonce="${nonce}" src="${mediaUrl('vendor/mermaid.min.js')}"></script>\n`;

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
<script nonce="${nonce}">${bootGuard}</script>
<link rel="stylesheet" href="${mediaUrl('vendor/katex/katex.min.css')}">
<link rel="stylesheet" href="${mediaUrl('preview.css')}">
</head>
<body style="--content-width:${options.contentWidth}%" data-anim="${options.animation ? 'smooth' : 'instant'}">
  <div class="shell">
    <div class="content-pane-wrap scroll-wrap">
      <div class="scroll-body content-pane" id="contentPane" data-scroll>
        <div class="content-inner" id="contentInner">
          ${options.bodyHtml}
        </div>
      </div>
      <div class="scroll-track"><div class="scroll-thumb"></div></div>
    </div>

    <div class="toc-pane-wrap scroll-wrap" id="tocPaneWrap">
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

    <button class="outline-toggle" id="outlineToggle" type="button" aria-controls="tocPaneWrap" aria-expanded="true" aria-label="Hide the outline">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
  </div>

  <script nonce="${nonce}">window.__PREVIEW_DATA__ = ${JSON.stringify(initialData)};</script>
${mermaidTag}  <script nonce="${nonce}" src="${mediaUrl('preview.js')}"></script>
</body>
</html>`;
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}
