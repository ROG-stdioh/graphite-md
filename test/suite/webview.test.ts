import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { countOf, evaluate, textOf, waitFor } from './cdp';

/**
 * The preview, driven for real.
 *
 * Every other layer stops short of the page. The BDD suite renders HTML and
 * reads the string; `scripts/graph-check.ts` loads the bundle into a double
 * whose DOM answers whatever the test author wrote into it — no layout, so
 * `clientHeight` is zero everywhere and the code that measures the page never
 * runs; the integration suite reaches the extension host but cannot see inside
 * a webview at all, by design of the API.
 *
 * These tests connect to the running page over the debugger (see `cdp.ts`) and
 * work it the way a reader does: click the checkbox and look at the file, fold
 * the outline and look at the pane, wait for mermaid and look at the drawing.
 * It is the difference between testing that a message was sent and testing that
 * the feature works.
 *
 * They are also the only tests that can fail for a layout reason — a hidden
 * pane, a zero-height body, an element the CSS moved. That is the class of bug
 * this layer exists for.
 */

const HEADING = 'The heading';

/**
 * Fixtures live in the temp directory, not the repo: several of these tests
 * edit their document, and one of them has to be saved to disk to prove the
 * edit is a real one. A temp directory means a failing run leaves nothing
 * behind, and nothing here can collide with a sample someone is reading.
 */
const FIXTURES = vscode.Uri.file(path.join(os.tmpdir(), 'graphite-md-webview-tests'));

/**
 * The document most of these tests open: one of everything that draws.
 *
 * A heading (an outline entry and a section), a paragraph, a task list (the
 * checkbox that writes back), and a blockquote (which the renderer turns into a
 * callout — the element the halftone is drawn on). Small on purpose: the page
 * is rebuilt on every render, and a fixture nobody can read is a fixture nobody
 * will maintain.
 */
const DOCUMENT = [
  `# ${HEADING}`,
  '',
  'A paragraph with **bold** and `code`.',
  '',
  '- [ ] a task',
  '- [x] a done task',
  '',
  '> A quoted paragraph, which the renderer turns into a callout.',
  '',
].join('\n');

/** The same document, long enough that the reading pane has something to scroll. */
const LONG_DOCUMENT = [
  `# ${HEADING}`,
  '',
  ...Array.from({ length: 400 }, (_, i) => `Line ${i} of a document that is taller than any window.`),
  '',
].join('\n');

/**
 * Mermaid, on its own.
 *
 * A separate fixture rather than a block in the one above, because the diagram
 * is the slowest thing on the page: with the script vendored, `mermaid.run`
 * parses, measures and lays out before it draws, and every test that loaded it
 * would pay for that.
 */
const DIAGRAM_DOCUMENT = [
  `# ${HEADING}`,
  '',
  '```mermaid',
  'graph TD; Start[Start here]-->Finish[Finish there];',
  '```',
  '',
].join('\n');

let counter = 0;

async function openFixture(content: string): Promise<vscode.TextDocument> {
  await vscode.workspace.fs.createDirectory(FIXTURES);
  const uri = vscode.Uri.joinPath(FIXTURES, `fixture-${counter++}.md`);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
  return doc;
}

/** Open the preview on a document and wait for its content to be on the page. */
async function preview(doc: vscode.TextDocument): Promise<void> {
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand('graphiteMd.open');
  await waitFor(
    `the preview to render "${HEADING}"`,
    `(() => {
      const h = document.querySelector('#contentInner h1');
      return h && String(h.textContent).includes(${JSON.stringify(HEADING)}) ? String(h.textContent) : null;
    })()`
  );
}

/** An expression that answers whether the outline pane is folded away. */
const FOLDED = 'document.querySelector("#tocPaneWrap").classList.contains("collapsed")';

/** Poll something on the host side of the boundary, where there is no page to ask. */
async function waitForHost(what: string, probe: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!probe()) {
    if (Date.now() >= deadline) assert.fail(`timed out after ${timeoutMs}ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

suite('the preview, driven through its own page', () => {
  teardown(async () => {
    const open = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => tab.input instanceof vscode.TabInputWebview);
    if (open.length > 0) await vscode.window.tabGroups.close(open);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('renders the document, and the outline beside it', async () => {
    await preview(await openFixture(DOCUMENT));

    const paragraph = await evaluate<string>(textOf('#contentInner p'));
    assert.ok(
      paragraph.includes('A paragraph with'),
      `the document's prose is not on the page; the first paragraph reads ${JSON.stringify(paragraph)}`
    );

    const rows = await waitFor<number>('the outline to be filled in', countOf('#graphContent .toc-row'));
    assert.strictEqual(rows, 1, 'the outline should hold the one heading the fixture has');
    assert.strictEqual(await evaluate<string>(textOf('#graphContent .toc-row .label')), HEADING);
  });

  test('ticks a checkbox, and the document behind it changes', async () => {
    const doc = await openFixture(DOCUMENT);
    await preview(doc);

    const line = await waitFor<string>(
      'the first task to render as a checkbox',
      `(() => {
        const box = document.querySelector('#contentInner .task-checkbox');
        return box ? box.dataset.line : null;
      })()`
    );

    await evaluate<void>('document.querySelector("#contentInner .task-checkbox").click()');

    // Optimistic in the page, so this is the click being handled — not the
    // round-trip coming back.
    assert.strictEqual(
      await evaluate<boolean>('document.querySelector("#contentInner .task-checkbox").classList.contains("checked")'),
      true,
      'the checkbox did not respond to the click'
    );

    // The boundary no other test crosses: a click in the page, an edit in the
    // extension host, a document that is now different.
    await waitForHost('the message to reach the document', () => doc.getText().includes('- [x] a task'));
    const clickedLine = doc.getText().split('\n')[Number(line)];
    assert.ok(
      clickedLine?.startsWith('- [x]'),
      `line ${line} is the checkbox that was clicked, but it now reads ${JSON.stringify(clickedLine)}`
    );

    // And it is a change to the file, not to a copy of it held in memory.
    await doc.save();
    const written = await vscode.workspace.fs.readFile(doc.uri);
    assert.ok(written.toString().includes('- [x] a task'), 'the edit never reached the file on disk');
  });

  test('draws the callout halftone, which is only drawn where there is a layout', async () => {
    await preview(await openFixture(DOCUMENT));

    await waitFor<number>('the callout to render', countOf('#contentInner .callout'));
    const dots = await waitFor<number>(
      'the halftone dots to be drawn',
      countOf('#contentInner .callout .halftone-svg circle')
    );
    assert.ok(dots > 0, 'the halftone svg has no dots in it');
  });

  test('measures the scrollbar against a page that overflows', async () => {
    await preview(await openFixture(LONG_DOCUMENT));

    const overflow = await evaluate<boolean>(
      'document.querySelector("#contentPane").scrollHeight > document.querySelector("#contentPane").clientHeight'
    );
    assert.ok(overflow, 'the fixture did not overflow the reading pane, so there is no scrollbar to measure');

    const height = await waitFor<string>(
      'the scrollbar thumb to be given a height',
      `(() => {
        const thumb = document.querySelector('.content-pane-wrap .scroll-thumb');
        return thumb && thumb.style.height ? thumb.style.height : null;
      })()`
    );
    assert.ok(parseFloat(height) > 0, `the thumb's height is ${height}`);
  });

  test('folds the outline from the corner control, and the button turns with it', async () => {
    await preview(await openFixture(DOCUMENT));
    assert.strictEqual(await evaluate<boolean>(FOLDED), false, 'the outline started folded');

    await evaluate<void>('document.querySelector("#outlineToggle").click()');
    await waitFor('the outline to fold', FOLDED);
    assert.strictEqual(await evaluate<string>('document.querySelector("#outlineToggle").getAttribute("aria-expanded")'), 'false');
    assert.strictEqual(await evaluate<string>('document.querySelector("#outlineToggle").getAttribute("aria-label")'), 'Show the outline');

    await evaluate<void>('document.querySelector("#outlineToggle").click()');
    await waitFor('the outline to come back', `!(${FOLDED})`);
    assert.strictEqual(await evaluate<string>('document.querySelector("#outlineToggle").getAttribute("aria-label")'), 'Hide the outline');
  });

  // The one that would have caught a wrong fold state if the feature had been
  // built and never opened: the palette command has to cross the extension host
  // boundary to reach the page, and the page's answer has to survive being
  // thrown away and rebuilt — which is what a re-render is.
  test('folds the outline from the palette command, and the fold survives a re-render', async () => {
    const doc = await openFixture(DOCUMENT);
    await preview(doc);
    assert.strictEqual(await evaluate<boolean>(FOLDED), false, 'the outline started folded');

    await vscode.commands.executeCommand('graphiteMd.toggleOutline');
    await waitFor('the command to fold the outline', FOLDED);

    // Any edit re-renders: the host debounces for 200ms, then assigns
    // `webview.html` again, and the page that comes back is a new document with
    // the old one's state restored out of `vscode.setState`.
    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, new vscode.Position(doc.lineCount, 0), '\nA paragraph added after the fold.\n');
    await vscode.workspace.applyEdit(edit);

    await waitFor(
      'the re-rendered page',
      'document.querySelector("#contentInner").textContent.includes("added after the fold")'
    );
    assert.strictEqual(await evaluate<boolean>(FOLDED), true, 'the fold was lost when the page was rebuilt');
  });

  test('sets mermaid drawing, and the drawing is the diagram', async () => {
    await preview(await openFixture(DIAGRAM_DOCUMENT));

    const labels = await waitFor<string>(
      'mermaid to draw the diagram',
      `(() => {
        const svg = document.querySelector('#contentInner .mermaid svg');
        const text = svg ? String(svg.textContent) : '';
        return text.includes('Start here') && text.includes('Finish there') ? text : null;
      })()`,
      30_000
    );
    assert.ok(labels.includes('Start here'), 'the diagram was drawn without its node labels');
  });
});
