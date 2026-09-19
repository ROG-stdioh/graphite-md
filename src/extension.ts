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

let currentPanel: vscode.WebviewPanel | undefined;
let currentDoc: vscode.TextDocument | undefined;

export function activate(context: vscode.ExtensionContext) {
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
              console.error('graphite.md: failed to open link', err);
            });
            return;
        }
      });

      maybeShowWidthTip(context);
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

  // `getText()` is inside the span rather than above it: it copies the whole
  // document out of VS Code's buffer and is part of what one keystroke costs
  // the host, so leaving it outside would understate the number this is here to
  // measure.
  const doneRender = span('host: renderMarkdown');
  const source = currentDoc.getText();
  let result;
  try {
    result = renderMarkdown(source, {
      resolveImage: imageSourceResolver(webview, currentDoc),
    });
  } catch (err) {
    console.error('graphite.md: failed to render document', err);
    webview.html = `<body style="font-family:sans-serif;padding:20px;color:#c00;">
      graphite.md failed to render this document. Check the "Log (Extension Host)" output panel for details.
    </body>`;
    return;
  }
  doneRender();
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
}

export function deactivate() {}
