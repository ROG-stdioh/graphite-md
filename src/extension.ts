import * as vscode from 'vscode';
import * as path from 'path';
import { renderMarkdown } from './markdown';

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
          localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))],
          retainContextWhenHidden: true,
        }
      );

      currentPanel.onDidDispose(() => {
        currentPanel = undefined;
      });

      currentPanel.webview.onDidReceiveMessage((message) => {
        if (message?.type === 'toggleTask' && typeof message.line === 'number' && currentDoc) {
          toggleTaskAt(currentDoc, message.line, !!message.checked);
        } else if (message?.type === 'openLink' && typeof message.href === 'string' && currentDoc) {
          openLink(message.href, currentDoc);
        }
      });

      maybeShowWidthTip(context);
    }

    renderIntoPanel(context);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('graphiteMd.open', () => openPreview(vscode.ViewColumn.Active)),
    vscode.commands.registerCommand('graphiteMd.openToSide', () => openPreview(vscode.ViewColumn.Beside)),

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
        const width = getContentWidth();
        currentPanel.webview.postMessage({ type: 'contentWidth', value: width });
      }
    })
  );
}

function getContentWidth(): number {
  return vscode.workspace.getConfiguration('graphiteMd').get<number>('contentWidth', 60);
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
  const lineText = doc.lineAt(lineIndex).text;
  const match = lineText.match(/^(\s*[-*+]\s+)\[[ xX]\]/);
  if (!match) return; // source drifted since render (user kept typing) — just skip, next render will resync

  const [, indent] = match;
  if (indent === undefined) return; // same as above: nothing to anchor an edit to
  const startCol = indent.length;
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

  let result;
  try {
    result = renderMarkdown(currentDoc.getText());
  } catch (err) {
    console.error('graphite.md: failed to render document', err);
    currentPanel.webview.html = `<body style="font-family:sans-serif;padding:20px;color:#c00;">
      graphite.md failed to render this document. Check the "Log (Extension Host)" output panel for details.
    </body>`;
    return;
  }
  const { html, headings, tables, diagrams } = result;
  const contentWidth = getContentWidth();

  currentPanel.title = path.basename(currentDoc.fileName);
  currentPanel.webview.html = buildWebviewHtml(context, currentPanel.webview, {
    bodyHtml: html,
    headings,
    tables,
    diagrams,
    contentWidth,
    doc: currentDoc,
  });
}

function buildWebviewHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
  data: {
    bodyHtml: string;
    headings: unknown;
    tables: unknown;
    diagrams: unknown;
    contentWidth: number;
    doc: vscode.TextDocument;
  }
): string {
  const mediaUri = (relPath: string) =>
    webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media', relPath)));

  // Webviews can serve a cached copy of media files across panel reopens,
  // which makes an updated preview.js silently keep its old behavior.
  // Bump this whenever the behavior of the media files changes so the
  // webview is forced to refetch them.
  const MEDIA_VERSION = '2';

  const nonce = getNonce();
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  const initialData = JSON.stringify({
    headings: data.headings,
    tables: data.tables,
    diagrams: data.diagrams,
  });

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${mediaUri('vendor/katex/katex.min.css')}">
<link rel="stylesheet" href="${mediaUri('preview.css')}?v=${MEDIA_VERSION}">
</head>
<body style="--content-width:${data.contentWidth}%">
  <div class="shell">
    <div class="content-pane-wrap scroll-wrap">
      <div class="scroll-body content-pane" id="contentPane" data-scroll>
        <div class="content-inner" id="contentInner">
          ${data.bodyHtml}
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

  <script nonce="${nonce}">window.__PREVIEW_DATA__ = ${initialData};</script>
  <script nonce="${nonce}" src="${mediaUri('vendor/mermaid.min.js')}"></script>
  <script nonce="${nonce}" src="${mediaUri('preview.js')}?v=${MEDIA_VERSION}"></script>
</body>
</html>`;
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

export function deactivate() {}
