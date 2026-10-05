import * as assert from 'assert';
import * as vscode from 'vscode';

/**
 * The layer no other test in this repo can reach.
 *
 * Everything else here renders markdown, checks a bundle or drives a double;
 * all of it runs in plain Node. `src/extension.ts` cannot run there at all —
 * it needs an extension host to hand it a `vscode` module — so the code that
 * decides what a user's keystroke does has been verified by reading it and by
 * opening a dev host by hand. This suite is that host, on rails.
 *
 * It is a separate job in CI on purpose: it downloads an editor, and a suite
 * that takes a minute to start is a suite nobody runs before pushing.
 */
const EXTENSION_ID = 'rog-stdioh.graphite-md';

/**
 * The prefix the editor service puts on a webview panel's *input type*, and the
 * reason this file has to know about it at all.
 *
 * `TabInputWebview.viewType` reports the editor input type — the string the
 * editor service registers the webview input under — and in the 1.134 build
 * that is `mainThreadWebview-` plus the view type the extension passed to
 * `createWebviewPanel`. The context key a command's `when` clause is compared
 * against is not that string. Read out of the shipped workbench
 * (`out/vs/workbench/workbench.desktop.main.js`, the webview editor service's
 * `getWebviewId`): `activeWebviewPanelId` is `webview.providedViewType` — the
 * bare type, exactly as the extension declared it. VS Code's own markdown
 * extension says the same thing from the other side, gating on
 * `activeWebviewPanelId == 'markdown.preview'` while its tab inputs read
 * `mainThreadWebview-markdown.preview`.
 *
 * Verified in the binary rather than assumed, because the test below exists to
 * pin those two strings against each other and would be worthless if it pinned
 * the wrong one. If a future editor renames the prefix this constant stops
 * matching, the comparison fails, and the failure names both strings — which is
 * the intended outcome: the assumption this file is built on needs re-reading,
 * not silencing.
 */
const INPUT_TYPE_PREFIX = 'mainThreadWebview-';

/** The manifest, as much of it as these tests read. */
interface Manifest {
  contributes?: {
    commands?: { command?: string }[];
    keybindings?: { command?: string; when?: string }[];
    menus?: Record<string, { command?: string; when?: string }[]>;
  };
}

function manifest(): Manifest {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `${EXTENSION_ID} is not installed in the test host`);
  return extension.packageJSON as Manifest;
}

/**
 * Every command the manifest contributes.
 *
 * Read out of the manifest rather than listed here, so the two cannot drift:
 * a hardcoded list asserts what someone typed into this file, while this
 * asserts the thing that actually matters — that the editor knows about every
 * command the extension advertises. A command in `contributes.commands` that
 * was never registered is an entry that appears in the palette and does
 * nothing when it is chosen.
 */
function contributedCommands(): string[] {
  return (manifest().contributes?.commands ?? [])
    .map((entry) => entry.command)
    .filter((id): id is string => typeof id === 'string');
}

/**
 * Every view type the manifest's own `when` clauses compare
 * `activeWebviewPanelId` against — collected from the whole manifest rather
 * than from one known binding, so a second preview-scoped command (a menu
 * entry, say) is held to the same string instead of quietly gating on one that
 * never matches.
 */
function gatedViewTypes(): string[] {
  const { keybindings = [], menus = {} } = manifest().contributes ?? {};
  const clauses = [...keybindings, ...Object.values(menus).flat()]
    .map((entry) => entry.when)
    .filter((when): when is string => typeof when === 'string');

  const found = new Set<string>();
  for (const clause of clauses) {
    for (const match of clause.matchAll(/activeWebviewPanelId\s*==\s*'([^']*)'/g)) {
      const [, viewType] = match;
      if (viewType !== undefined) found.add(viewType);
    }
  }
  return [...found];
}

/** The open webview panels, with the type each was created with. */
function webviewTabs(): { tab: vscode.Tab; viewType: string }[] {
  const found: { tab: vscode.Tab; viewType: string }[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputWebview) found.push({ tab, viewType: tab.input.viewType });
    }
  }
  return found;
}

/** The view type the extension declared, with the input type's prefix removed. */
function providedViewType(viewType: string): string {
  return viewType.startsWith(INPUT_TYPE_PREFIX) ? viewType.slice(INPUT_TYPE_PREFIX.length) : viewType;
}

/**
 * Poll until `probe` answers, because the editor tells us about a tab rather
 * than returning it.
 *
 * `executeCommand('graphiteMd.open')` resolves when the extension's handler
 * returns, which is the moment the panel is *created*. The tab model is a
 * different service on the other side of the extension host boundary, and the
 * change reaches `vscode.window.tabGroups` a turn or two later. Asserting
 * immediately is what made this suite's first run report "opened no webview
 * panel" for a panel that was open by the time the next test looked.
 */
async function waitFor<T>(what: string, probe: () => T | undefined, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() >= deadline) assert.fail(`timed out after ${timeoutMs}ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** One turn of the event loop, for the cases with nothing specific to wait on. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100));
}

/**
 * A markdown document that exists only in memory.
 *
 * Untitled rather than a file in a temp directory: no cleanup, no fixtures to
 * keep in step with the renderer, and — because the preview tracks the active
 * editor rather than a path — nothing about the tests depends on where it
 * lives. The language id is the part that matters, since it is what both the
 * command's guard and the manifest's `when` clauses read.
 */
async function openDocument(language: string, content: string): Promise<vscode.TextDocument> {
  const doc = await vscode.workspace.openTextDocument({ language, content });
  await vscode.window.showTextDocument(doc);
  return doc;
}

/** Run a command that opens the preview, and wait for the panel it opens. */
async function openPreview(command: string): Promise<{ tab: vscode.Tab; viewType: string }> {
  const before = webviewTabs().length;
  await vscode.commands.executeCommand(command);
  return waitFor(`the preview to open (${command})`, () => {
    const open = webviewTabs();
    return open.length > before ? open[open.length - 1] : undefined;
  });
}

/** The tab group a tab is in, or undefined if the tab model has not caught up. */
function groupOf(tab: vscode.Tab): vscode.TabGroup | undefined {
  return vscode.window.tabGroups.all.find((group) => group.tabs.includes(tab));
}

/**
 * Close every preview and wait for the extension to hear about it.
 *
 * Closing the tab is what disposes the panel, and the extension's
 * `onDidDispose` — which is what clears its module-level `currentPanel` — is
 * delivered over the same boundary the tab model arrives on. Without the wait,
 * the next test's `graphiteMd.open` can be answered by `reveal()` on a panel
 * that is already gone.
 */
async function closePreviews(): Promise<void> {
  const open = webviewTabs();
  if (open.length === 0) return;
  await vscode.window.tabGroups.close(open.map(({ tab }) => tab));
  await settle();
}

suite('the extension inside a real editor', () => {
  teardown(closePreviews);

  test('activates', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not installed in the test host`);
    await extension.activate();
    assert.strictEqual(extension.isActive, true);
  });

  test('registers every command the manifest contributes', async () => {
    const contributed = contributedCommands();
    assert.ok(contributed.length > 0, 'the manifest contributes no commands, so this test would prove nothing');

    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = contributed.filter((id) => !registered.has(id));
    assert.deepStrictEqual(
      missing,
      [],
      'contributed in the manifest but never registered, so the palette entry does nothing'
    );
  });

  test('opens the preview as a webview panel', async () => {
    await openDocument('markdown', '# A document\n\nWith a paragraph.\n');
    await openPreview('graphiteMd.open');
    assert.strictEqual(webviewTabs().length, 1, 'the preview opened more than one panel');
  });

  // The check that only a running editor can make, and the reason it is worth
  // making: the keybinding that folds the outline is gated on
  // `activeWebviewPanelId`, which is the *view type* the panel was created with
  // — a string written in two places, one of which the compiler cannot see. A
  // rename on either side leaves a binding that is simply never offered, with
  // nothing failing anywhere.
  test('...whose type is the one the manifest gates preview commands on', async () => {
    await openDocument('markdown', '# A document\n');
    const panel = await openPreview('graphiteMd.open');

    const gated = gatedViewTypes();
    assert.ok(gated.length > 0, 'no command is gated on activeWebviewPanelId, so this test would prove nothing');

    const provided = providedViewType(panel.viewType);
    assert.ok(
      gated.includes(provided),
      `the preview opens as "${provided}", but the manifest gates on ${gated.map((id) => `"${id}"`).join(' or ')}`
    );
  });

  test('opening to the side puts the preview in a group of its own', async () => {
    const doc = await openDocument('markdown', '# A document\n');

    const documentTabs = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === doc.uri.toString());
    const [openDocumentTab] = documentTabs;
    assert.ok(openDocumentTab, `the document ${doc.uri.toString()} is not in the tab model`);

    const panel = await openPreview('graphiteMd.openToSide');

    const documentGroup = groupOf(openDocumentTab);
    const previewGroup = groupOf(panel.tab);
    assert.ok(documentGroup && previewGroup, 'a tab went missing from the tab model');
    assert.notStrictEqual(
      previewGroup.viewColumn,
      documentGroup.viewColumn,
      'the preview was opened on top of the document rather than beside it'
    );
  });

  test('a second open reveals the preview rather than adding another', async () => {
    await openDocument('markdown', '# A document\n');
    await openPreview('graphiteMd.open');
    await vscode.commands.executeCommand('graphiteMd.open');
    await settle();
    assert.strictEqual(webviewTabs().length, 1, 'opening twice opened a second preview');
  });

  test('reopening after the preview is closed starts a new panel', async () => {
    await openDocument('markdown', '# A document\n');
    await openPreview('graphiteMd.open');
    await closePreviews();
    assert.strictEqual(webviewTabs().length, 0, 'the preview did not close');

    await openPreview('graphiteMd.open');
    assert.strictEqual(webviewTabs().length, 1, 'the preview did not come back');
  });

  test('does nothing when the active editor is not Markdown', async () => {
    await openDocument('plaintext', 'not markdown at all\n');
    await vscode.commands.executeCommand('graphiteMd.open');
    await settle();
    assert.strictEqual(webviewTabs().length, 0, 'a preview opened for a document that is not Markdown');
  });
});
