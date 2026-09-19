import * as vscode from 'vscode';
import * as path from 'path';
import { renderMarkdown } from './markdown';
import { isWebviewToHost } from './shared/protocol';
import type { HostToWebview } from './shared/protocol';
import { buildWebviewHtml } from './webviewHtml';
import { resolveContentWidth, resolveRemoteImages, REMOTE_IMAGES_DEFAULT, CONTENT_WIDTH_MIN } from './settings';
import { taskMarkerColumn } from './taskMarker';
import { planImageSource } from './sourceRef';
import { span, report } from './shared/perf';
import { log, setLogger, describeCause, oneLine } from './logger';

let currentPanel: vscode.WebviewPanel | undefined;
let currentDoc: vscode.TextDocument | undefined;

/**
 * What has already been said about the document on screen.
 *
 * Both are keyed on the document and reset when the preview moves to another
 * one, because every answer here is per file: a render line that is worth
 * reading once, and an image that is worth warning about once. Without the
 * second, a document holding five remote images would repeat all five on every
 * keystroke — which is the noise that makes a log unreadable at exactly the
 * moment somebody is reading it.
 */
let announcedDoc: string | undefined;
const refusedImages = new Set<string>();

/**
 * The extension's own version, off the manifest VS Code has already loaded.
 *
 * Guarded rather than cast: `packageJSON` is typed `any`, and a version line
 * that prints "undefined" is worse than one that admits it does not know.
 */
function packageVersion(context: vscode.ExtensionContext): string {
  const manifest: unknown = context.extension.packageJSON;
  const version =
    typeof manifest === 'object' && manifest !== null
      ? (manifest as Record<string, unknown>).version
      : undefined;
  return typeof version === 'string' ? version : 'unknown version';
}

/**
 * A log line the webview sent.
 *
 * The webview is a separate context and its text originates in the document, so
 * nothing about it is trusted: it is one-lined and bounded here as well as at
 * the point it was written, because the two checks defend different things. The
 * sender's keeps its own message readable; this one holds even if the sender
 * turns out not to be this extension's webview at all.
 */
function logFromWebview(level: 'info' | 'warn' | 'error', message: string): void {
  const text = `webview: ${oneLine(message)}`;
  switch (level) {
    case 'info':
      log.info(text);
      return;
    case 'warn':
      log.warn(text);
      return;
    case 'error':
      log.error(text);
      return;
  }
}

export function activate(context: vscode.ExtensionContext) {
  // Created before anything can fail and before any command can run. The
  // channel has to be in the Output dropdown while the extension is healthy,
  // because the moment a user goes looking for it is the moment something has
  // already gone wrong — and a channel created on first error is absent at
  // exactly that moment.
  const output = vscode.window.createOutputChannel('graphite.md', { log: true });
  context.subscriptions.push(output);

  setLogger({
    info: (message) => {
      output.info(message);
    },
    debug: (message) => {
      output.debug(message);
    },
    warn: (message, cause) => {
      output.warn(describeCause(message, cause));
    },
    error: (message, cause) => {
      output.error(describeCause(message, cause));
    },
  });

  log.info(`graphite.md ${packageVersion(context)} · VS Code ${vscode.version} · ${process.platform}`);

  const openPreview = (column: vscode.ViewColumn) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown') {
      vscode.window.showInformationMessage('Open a Markdown file first.');
      return;
    }
    currentDoc = editor.document;

    if (currentPanel) {
      currentPanel.reveal(column);
    } else {
      currentPanel = vscode.window.createWebviewPanel(
        'graphiteMd',
        'graphite.md Preview',
        column,
        {
          enableScripts: true,
          localResourceRoots: resourceRoots(context, currentDoc),
          retainContextWhenHidden: true,
        }
      );

      currentPanel.onDidDispose(() => {
        currentPanel = undefined;
        log.info('preview closed');
      });

      // `message` arrives as `any` — onDidReceiveMessage is typed that way, and
      // it is telling the truth: this is a different script in a different
      // context, and nothing about its shape is guaranteed. The guard is what
      // makes the parameter `unknown` and earns the narrowing that follows.
      currentPanel.webview.onDidReceiveMessage((message: unknown) => {
        if (!isWebviewToHost(message)) return;
        const doc = currentDoc;
        if (!doc) return;
        // A switch with no default, so switch-exhaustiveness-check — the rule
        // this boundary exists to give work to — fails the build when a variant
        // is added here and not handled. An if/else would compile: the else
        // branch would just quietly become "everything that is not toggleTask".
        switch (message.type) {
          case 'toggleTask':
            toggleTaskAt(doc, message.line, message.checked);
            return;
          case 'openLink':
            // Not `void openLink(...)`: that discards rejections, and openLink
            // awaits openExternal (which rejects when the OS has no handler for
            // the scheme) and Uri.parse (which can throw on a malformed href).
            // Losing those to an unhandled rejection leaves a click on a broken
            // link doing nothing at all, with nothing in the log.
            openLink(message.href, doc).catch((err: unknown) => {
              log.error(`failed to open link ${oneLine(message.href)}`, err);
            });
            return;
          case 'log':
            logFromWebview(message.level, message.message);
            return;
        }
      });

      maybeShowWidthTip(context);
      log.info(`preview opened · tracking ${oneLine(path.basename(currentDoc.fileName))}`);
    }

    renderIntoPanel(context);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('graphiteMd.open', () => {
      openPreview(vscode.ViewColumn.Active);
    }),
    vscode.commands.registerCommand('graphiteMd.openToSide', () => {
      openPreview(vscode.ViewColumn.Beside);
    }),

    // The way in for a user who has not discovered the Output dropdown, or who
    // has it scrolled to some other channel. Deliberately outside the two
    // `editorLangId == markdown` restrictions above: whatever has gone wrong may
    // be that no Markdown file is open at all.
    vscode.commands.registerCommand('graphiteMd.showOutput', () => {
      output.show();
    }),

    // live-update as the user types
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (currentPanel && currentDoc && e.document.uri.toString() === currentDoc.uri.toString()) {
        renderIntoPanel(context);
      }
    }),

    // switch which document the preview tracks when focus moves to another markdown file
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (currentPanel && editor && editor.document.languageId === 'markdown') {
        currentDoc = editor.document;
        renderIntoPanel(context);
      }
    }),

    // settings.json edited directly -> push the new value to the webview
    // without a full re-render (full re-render would reset scroll position)
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (currentPanel && e.affectsConfiguration('graphiteMd.contentWidth')) {
        const message: HostToWebview = { type: 'contentWidth', value: getContentWidth() };
        currentPanel.webview.postMessage(message);
      }

      // Remote images cannot take the message path above: the answer lives in
      // the page's CSP, which is part of the document, so changing it needs a
      // new one. Scroll position is lost, which is the honest cost of changing
      // what the page is allowed to load.
      if (currentPanel && e.affectsConfiguration('graphiteMd.remoteImages')) {
        renderIntoPanel(context);
      }
    })
  );
}

function getContentWidth(): number {
  const config = vscode.workspace.getConfiguration('graphiteMd');
  // inspect() rather than a literal 60: the default belongs to the contribution
  // in package.json, and a second copy here is how the two drift apart.
  const declared = config.inspect<unknown>('contentWidth')?.defaultValue;
  const fallback = typeof declared === 'number' ? declared : CONTENT_WIDTH_MIN;
  const raw: unknown = config.get('contentWidth');
  return resolveContentWidth(raw, fallback);
}

function getRemoteImages(): boolean {
  const config = vscode.workspace.getConfiguration('graphiteMd');
  // Same reasoning as getContentWidth: the default belongs to the contribution
  // in package.json, and a second copy here is how the two drift apart.
  const declared = config.inspect<unknown>('remoteImages')?.defaultValue;
  const fallback = typeof declared === 'boolean' ? declared : REMOTE_IMAGES_DEFAULT;
  return resolveRemoteImages(config.get('remoteImages'), fallback);
}

/**
 * What the webview is allowed to read off disk.
 *
 * The extension's own media folder is always there. The document's folder has
 * to be as well, or an image sitting beside the document cannot be served even
 * though its URL was built correctly — the webview refuses anything outside
 * these roots. Workspace folders come along because a document may reach
 * sideways (`![](../shared/logo.png)`) and because that is what VS Code's own
 * Markdown preview grants.
 *
 * Read once at panel creation and again whenever the preview switches to a
 * different document. Webview options are settable after creation, and the
 * value is consulted when `webview.html` is next assigned — which is the very
 * next thing renderIntoPanel does, so a switch takes effect on that render.
 */
function resourceRoots(
  context: vscode.ExtensionContext,
  doc: vscode.TextDocument | undefined
): vscode.Uri[] {
  const roots = [vscode.Uri.file(path.join(context.extensionPath, 'media'))];
  for (const folder of vscode.workspace.workspaceFolders ?? []) roots.push(folder.uri);
  if (doc) roots.push(vscode.Uri.joinPath(doc.uri, '..'));
  return roots;
}

/**
 * Turns an image `src` written in the document into a URL the webview can load.
 *
 * Only the host can do this: the renderer is a pure string function with no
 * idea where the document lives, and a relative URL inside a webview resolves
 * against the *webview's* origin rather than the document's folder. Without
 * this every image in every document was a broken box.
 *
 * A source naming a scheme is left exactly as written and never rewritten.
 * `data:` is admitted by the page's CSP and needs no help; `https:` is admitted
 * only when the user has turned remote images on, and the CSP is what enforces
 * that — so the policy lives in one place instead of being split between a
 * decision here and a permission there.
 */
function imageSourceResolver(
  webview: vscode.Webview,
  doc: vscode.TextDocument
): (src: string) => string | undefined {
  return (src) => {
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    const plan = planImageSource(src, folder !== undefined);

    switch (plan.kind) {
      case 'refuse':
        noteRefusedImage(doc, src, plan.reason);
        return undefined;
      case 'uri':
        try {
          return webview.asWebviewUri(vscode.Uri.parse(plan.uri)).toString();
        } catch {
          // Defensive rather than known: a source that cannot be turned into a
          // URI should cost one picture, and letting it throw would cost the
          // document, since the caller turns a render failure into an error page.
          return undefined;
        }
      case 'path': {
        // joinPath normalises "..", and keeps whatever scheme the document uses
        // (file:, vscode-remote:, …) instead of assuming a local disk.
        const docDir = vscode.Uri.joinPath(doc.uri, '..');
        const base = plan.from === 'folder' && folder ? folder.uri : docDir;
        return webview.asWebviewUri(vscode.Uri.joinPath(base, plan.path)).toString();
      }
    }
  };
}

/**
 * Says once, per document, that an image was left to the page's CSP.
 *
 * Only the remote case gets a word, and only while remote images are off. That
 * is the one refusal a reader can act on, and its symptom — a broken image with
 * nothing anywhere accounting for it — is half of what sends somebody looking
 * for a log in the first place. A `data:` image, a bare `#fragment`, a remote
 * image the user has already allowed: all silent, because a warning printed
 * against a picture that is about to load correctly teaches a reader to ignore
 * warnings.
 *
 * The source is one-lined before it goes in, because it is text out of the
 * document and a log entry a reader cannot trust is worse than no entry. Host
 * errors go in whole, stacks included — those are generated here, and a stack
 * that has been flattened to one line has lost the only thing it was for.
 */
function noteRefusedImage(doc: vscode.TextDocument, src: string, reason: 'remote' | 'other'): void {
  if (reason !== 'remote' || getRemoteImages()) return;
  const key = `${doc.uri.toString()}\u0000${src}`;
  if (refusedImages.has(key)) return;
  refusedImages.add(key);
  log.warn(
    `not loading ${oneLine(src)} — remote images are off. Set "graphiteMd.remoteImages" to load images from the network.`
  );
}

const WIDTH_TIP_DISMISSED_KEY = 'graphiteMd.hideWidthTip';

function maybeShowWidthTip(context: vscode.ExtensionContext): void {
  if (context.globalState.get<boolean>(WIDTH_TIP_DISMISSED_KEY, false)) return;

  vscode.window
    .showInformationMessage(
      'graphite.md: you can adjust the reading column width via the "graphiteMd.contentWidth" setting.',
      'Show me',
      'Dismiss',
      "Don't show again"
    )
    .then((choice) => {
      if (choice === 'Show me') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'graphiteMd.contentWidth');
      } else if (choice === "Don't show again") {
        context.globalState.update(WIDTH_TIP_DISMISSED_KEY, true);
      }
    });
}

function toggleTaskAt(doc: vscode.TextDocument, lineIndex: number, checked: boolean): void {
  if (lineIndex < 0 || lineIndex >= doc.lineCount) return;
  const startCol = taskMarkerColumn(doc.lineAt(lineIndex).text);
  if (startCol === undefined) return; // source drifted since render (user kept typing) — just skip, next render will resync

  const range = new vscode.Range(lineIndex, startCol, lineIndex, startCol + 3);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, range, checked ? '[x]' : '[ ]');
  vscode.workspace.applyEdit(edit);
}

/**
 * A link was clicked in the preview. Absolute URLs belong to the OS; anything
 * else is a path relative to the document on screen and opens in the editor —
 * the same split VS Code's own Markdown preview makes.
 *
 * This exists because the webview cannot tell the two apart: left to itself it
 * hands a bare "setup.md" to the OS as an external URL, and since .md is a real
 * TLD that opens a stranger's website rather than the file next to the doc.
 */
async function openLink(href: string, doc: vscode.TextDocument): Promise<void> {
  // A fragment is handled inside the webview; strip any that rides along on a
  // file link so it doesn't end up as part of the filename.
  const [rawPath] = href.split('#');

  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    const uri = vscode.Uri.parse(href);
    // file: links are the user's own workspace — open them in the editor
    // rather than bouncing them out to the OS.
    if (uri.scheme === 'file') {
      await vscode.commands.executeCommand('vscode.open', uri).then(undefined, () =>
        vscode.window.showWarningMessage(`graphite.md: cannot open ${href}`)
      );
    } else {
      await vscode.env.openExternal(uri);
    }
    return;
  }

  if (!rawPath) return; // pure "#fragment" — nothing to open

  let relative = rawPath;
  try {
    relative = decodeURIComponent(rawPath);
  } catch {
    // malformed percent-encoding — use the raw form rather than failing
  }

  // joinPath normalises "..", so ../notes/x.md works, and it keeps whatever
  // scheme the document uses (file:, vscode-remote:, …) instead of assuming
  // a local disk. A leading "/" is treated as document-relative, not
  // workspace-relative — rare in practice, and the built-in preview's
  // root-relative behaviour is not worth guessing at here.
  const target = vscode.Uri.joinPath(doc.uri, '..', relative);

  try {
    const stat = await vscode.workspace.fs.stat(target);
    if (stat.type === vscode.FileType.Directory) {
      await vscode.commands.executeCommand('revealInExplorer', target);
      return;
    }
    await vscode.commands.executeCommand('vscode.open', target);
  } catch {
    vscode.window.showWarningMessage(
      `graphite.md: no file at "${relative}" — links resolve relative to ${path.basename(doc.uri.fsPath)}.`
    );
  }
}

function renderIntoPanel(context: vscode.ExtensionContext) {
  if (!currentPanel || !currentDoc) return;
  // Captured because the guard above narrows the module-level `currentPanel`
  // only until the next statement that could reassign it — and the callbacks
  // below outlive that. `webview` is a const, so it stays narrowed.
  const webview = currentPanel.webview;

  // The document's folder has to be in the roots *before* the HTML that
  // references it is assigned, or the webview refuses the images it is about to
  // be handed. Both happen below, in that order, on every render.
  webview.options = {
    enableScripts: true,
    localResourceRoots: resourceRoots(context, currentDoc),
  };

  const docKey = currentDoc.uri.toString();
  const firstRenderForDoc = docKey !== announcedDoc;
  // Cleared before the render rather than after: the resolver runs inside
  // renderMarkdown, so the set has to be empty by the time it is called or the
  // first render of a new document would stay quiet about its own images.
  if (firstRenderForDoc) refusedImages.clear();

  // `getText()` is inside the span rather than above it: it copies the whole
  // document out of VS Code's buffer and is part of what one keystroke costs
  // the host, so leaving it outside would understate the number this is here to
  // measure.
  const doneRender = span('host: renderMarkdown');
  // Both timings are taken, and they are not the same measurement. This one is
  // always on, because the render line in the Output Channel is a product
  // feature; `span` above compiles out of releases, because the profiler is
  // not. Measuring one with the other's clock would tie a shipped feature to a
  // dev-only build.
  const startedAt = performance.now();
  const source = currentDoc.getText();
  let result;
  try {
    result = renderMarkdown(source, {
      resolveImage: imageSourceResolver(webview, currentDoc),
    });
  } catch (err) {
    log.error('failed to render document', err);
    webview.html = `<body style="font-family:sans-serif;padding:20px;color:#c00;">
      graphite.md failed to render this document. The "graphite.md" output channel has the details.
    </body>`;
    return;
  }
  doneRender();
  announcedDoc = docKey;
  const { html, headings, tables, diagrams } = result;

  currentPanel.title = path.basename(currentDoc.fileName);
  const doneHtml = span('host: buildWebviewHtml');
  webview.html = buildWebviewHtml({
    mediaDir: path.join(context.extensionPath, 'media'),
    // Returns a string, not a Uri. asWebviewUri hands back a Uri, and a Uri
    // interpolated into a template happens to stringify correctly — but
    // "happens to" is the whole problem: it is the Uri's toString being relied
    // on implicitly at every call site. Converting once, here, where the
    // value's only purpose is to be written into an attribute, makes that
    // explicit and leaves the page builder interpolating plain strings.
    toWebviewUri: (absPath) => webview.asWebviewUri(vscode.Uri.file(absPath)).toString(),
    cspSource: webview.cspSource,
    remoteImages: getRemoteImages(),
    contentWidth: getContentWidth(),
    bodyHtml: html,
    headings,
    tables,
    diagrams,
  });
  doneHtml();

  // The host half of the profile. It is printed here rather than in the webview
  // because the two run in different processes: this line lands in the
  // Extension Host output, the webview's own report lands in the webview
  // DevTools console, and a reload writes one of each.
  report(
    `host render · ${path.basename(currentDoc.fileName)} · ${source.length} chars, ${source.split('\n').length} lines`
  );

  // The line a user reads to see that the preview is keeping up. The first
  // render of a document goes in at info and the rest at debug, because typing
  // produces one of these per keystroke: someone with the channel open watching
  // for trouble should not have to scroll past a paragraph of them to find it,
  // and `debug` is the level whose whole meaning is "show me everything" —
  // which is exactly what somebody chasing a slow preview wants.
  const elapsed = performance.now() - startedAt;
  const summary =
    `${oneLine(path.basename(currentDoc.fileName))} · ${source.length} bytes · ` +
    `${headings.length} headings, ${tables.length} tables, ${diagrams.length} diagrams · ${elapsed.toFixed(0)} ms`;
  if (firstRenderForDoc) log.info(`rendered ${summary}`);
  else log.debug(`rendered ${summary}`);
}

export function deactivate() {}
