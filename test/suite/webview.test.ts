import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { countOf, evaluate, settle, textOf, waitFor } from './cdp';

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
const SECTION = 'A section';

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
 * A title, a paragraph, a section under it (the outline's one row), a task list
 * (the checkbox that writes back), and a blockquote (which the renderer turns
 * into a callout — the element the halftone is drawn on). Small on purpose: the
 * page is rebuilt on every render, and a fixture nobody can read is a fixture
 * nobody will maintain.
 *
 * The title and the section are both here on purpose, and the difference is the
 * part worth keeping: a level-1 heading is the document's own title, which the
 * page shows at the top and the pane does *not* list, while a level-2 heading
 * under it is a section, which the pane exists to list. The fixture used to
 * carry only the title, and the test below — asserting the pane held one row —
 * was written against the behaviour the author expected rather than the one the
 * renderer has.
 */
const DOCUMENT = [
  `# ${HEADING}`,
  '',
  'A paragraph with **bold** and `code`.',
  '',
  `## ${SECTION}`,
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

/**
 * The name a fixture's own last line carries, so its page can be told from the
 * previous test's.
 *
 * Every fixture here opens with the same level-1 heading, which means a
 * readiness check for "the heading is on the page" is satisfied by the page the
 * *previous* test left up — the panel is closed in teardown and opened again a
 * moment later, and for that moment the old page is still the one answering.
 * Two tests read the wrong document that way before this existed, one of them
 * only sometimes. The marker is unique per fixture and appears nowhere else, so
 * waiting on it waits on the document that was just opened.
 */
function markerOf(doc: vscode.TextDocument): string {
  return path.basename(doc.uri.fsPath, '.md');
}

async function openFixture(content: string): Promise<vscode.TextDocument> {
  await vscode.workspace.fs.createDirectory(FIXTURES);
  const name = `fixture-${counter++}`;
  const uri = vscode.Uri.joinPath(FIXTURES, `${name}.md`);
  // Last, so it cannot shift a line number or become the first paragraph some
  // other assertion reads.
  await vscode.workspace.fs.writeFile(uri, Buffer.from(`${content}\n${name}\n`, 'utf8'));
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
  return doc;
}

/** Open the preview on a document and wait for its content to be on the page. */
async function preview(doc: vscode.TextDocument): Promise<void> {
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand('graphiteMd.open');
  const marker = markerOf(doc);
  await waitFor(
    `the preview to render ${marker}`,
    `(() => {
      const pane = document.querySelector('#contentInner');
      return pane && pane.textContent.includes(${JSON.stringify(marker)}) ? pane.textContent : null;
    })()`
  );
  // And that it is the last page, not one that is about to be replaced: the
  // marker only says the content arrived, and the host may still have a render
  // in flight behind it. See `settle`.
  await settle();
  // Then that the page has its stylesheet. See `styled`.
  await styled();
}

/**
 * Wait for the preview's own stylesheet to have arrived.
 *
 * The sheet is a separate request from the HTML, and a `<link>` in the head
 * does not hold up the body: a document can be complete enough to find
 * `#contentInner` in and still have no styles at all, stacked as one column of
 * plain blocks. Every measurement in this file is a measurement of layout, so
 * on a slow machine that page is not "nearly ready", it is a different page —
 * and one that answers with numbers reading exactly like a broken feature.
 * Observed on a slow run, before this wait existed: the corner control 2900px
 * down the page and the scrollbar's track the width of the window, reported as
 * the control overlapping the bar by 37px.
 *
 * A reader never sees that page, and this is not a stand-in for a product bug:
 * a browser paints nothing until its stylesheets are in, so the unstyled
 * document exists only between the parse and the first paint — which is exactly
 * the window a debugger can evaluate in, and the reason this is fixed here
 * rather than in the preview.
 *
 * `cssRules` is the signal, and it is about the file arriving rather than about
 * any particular rule: the browser puts the sheet in `document.styleSheets` the
 * moment it parses the tag, with no rules in it until the file lands. Waiting
 * on a computed style instead would tie every test's setup to one rule, and
 * fail the whole file — with a message about styling — the day that rule is
 * legitimately changed.
 *
 * After `settle`, deliberately. Both are polls of the live page, so if a
 * re-render lands during this one the new document simply has to fetch its
 * stylesheet before this can return; the reverse order would let the page
 * settle after the styles were confirmed.
 */
async function styled(): Promise<void> {
  await waitFor(
    'the preview to be styled',
    `(() => {
      const sheet = [...document.styleSheets].find((s) => String(s.href).includes('preview.css'));
      if (!sheet) return null;
      try {
        return sheet.cssRules.length > 0;
      } catch {
        return null;
      }
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
    assert.strictEqual(rows, 1, 'the outline should hold the one section the fixture has');
    // Named the section rather than the title, which is the assertion with
    // teeth: a pane that listed the level-1 heading would also find exactly one
    // row here, and the label is what tells the two apart.
    assert.strictEqual(await evaluate<string>(textOf('#graphContent .toc-row .label')), SECTION);
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

    // Clicked and read in one expression, deliberately: two round trips leave a
    // gap for a re-render to land in, and the page that replaced this one draws
    // its boxes from the document — which has not been edited yet, because the
    // edit is what the click just asked the host for. Read in the same
    // expression, what the assertion sees is the page's own handler running,
    // which is exactly what it is asserting.
    const responded = await evaluate<boolean>(
      `(() => {
        const box = document.querySelector('#contentInner .task-checkbox');
        box.click();
        return box.classList.contains('checked');
      })()`
    );
    // Optimistic in the page, so this is the click being handled — not the
    // round-trip coming back.
    assert.ok(responded, 'the checkbox did not respond to the click');

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

    const pane = await evaluate<{ scroll: number; client: number; text: number }>(
      `(() => {
        const pane = document.querySelector('#contentPane');
        return { scroll: pane.scrollHeight, client: pane.clientHeight, text: (document.querySelector('#contentInner') || {}).textContent.length };
      })()`
    );
    assert.ok(
      pane.scroll > pane.client,
      `the fixture did not overflow the reading pane, so there is no scrollbar to measure: ${JSON.stringify(pane)}`
    );

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

    await evaluate('document.querySelector("#outlineToggle").click()');
    await waitFor('the outline to fold', FOLDED);
    assert.strictEqual(await evaluate<string>('document.querySelector("#outlineToggle").getAttribute("aria-expanded")'), 'false');
    assert.strictEqual(await evaluate<string>('document.querySelector("#outlineToggle").getAttribute("aria-label")'), 'Show the outline');

    await evaluate('document.querySelector("#outlineToggle").click()');
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

  // The corner is shared, and the two things in it are drawn by different parts
  // of the page: the button is placed against the preview's top-right, and a
  // pane's scrollbar is positioned inside whichever pane reaches that edge.
  // Nothing else in the repo can see the collision — the BDD suite reads HTML
  // with no layout, and the graph-check double has no geometry at all — so this
  // is the only test that would notice the button drifting back over the bar.
  test('keeps the corner control clear of the scrollbar, open and folded', async () => {
    await preview(await openFixture(LONG_DOCUMENT));

    // Measured against the bar's lane rather than the track's own box: the
    // track is 6px wide and holds a thumb that grows to 8px and steps 1px
    // outward on hover, so the bar reaches one pixel past the element that
    // holds it — and a control that clears the box has not necessarily cleared
    // the bar.
    const THUMB_REACH = 1;
    interface Geometry {
      gap: number;
      button: { left: number; top: number; w: number; h: number };
      bar: { left: number; right: number; w: number };
      /** Carried for the failure message: the padding a webview injects was the
       * whole of the bug this test was written for, and it shows up here. */
      viewport: number;
    }
    const clearance = async (track: string): Promise<Geometry> =>
      evaluate<Geometry>(
        `(() => {
          const button = document.querySelector('#outlineToggle').getBoundingClientRect();
          const bar = document.querySelector(${JSON.stringify(track)}).getBoundingClientRect();
          return {
            gap: (bar.left - ${THUMB_REACH}) - button.right,
            button: { left: button.left, top: button.top, w: button.width, h: button.height },
            bar: { left: bar.left, right: bar.right, w: bar.width },
            viewport: document.documentElement.clientWidth,
          };
        })()`
      );
    const explain = (where: string, g: { gap: number }): string =>
      `${where}: the control sits ${String(g.gap)}px from the scrollbar's lane — ${JSON.stringify(g)}`;

    // While the pane is open, the button shares the corner with the outline's
    // own bar; once folded, the reading column's bar is the one underneath it.
    // The folded state is the one the overlap was reported in, and the one where
    // a pane that is merely zero-width (the animated fold) still lays its bar
    // out at the edge of the window.
    const open = await clearance('.toc-pane-wrap .scroll-track');
    assert.ok(open.gap >= 10, explain('while the pane is open', open));

    await evaluate('document.querySelector("#outlineToggle").click()');
    await waitFor('the outline to fold', FOLDED);
    // Then wait for the fold to finish. The class lands at once while the width
    // is animated — 200ms by default — and measured inside that window the
    // reading column's bar is still most of a pane's width from the corner,
    // which reads as the control having drifted a mile rather than as a test
    // that measured too early. Waiting on the pane's own width rather than on a
    // clock is what makes the same test right for the instant fold, where the
    // pane is gone before the next frame.
    await waitFor(
      'the pane to finish folding away',
      `document.querySelector('#tocPaneWrap').getBoundingClientRect().width < 2`
    );
    const folded = await clearance('.content-pane-wrap .scroll-track');
    assert.ok(folded.gap >= 10, explain('while the pane is folded', folded));

    // And the target is worth aiming at: the control is 32px square, which is
    // what the chevron was redrawn for. Read off the button rather than off the
    // stylesheet, so shrinking it back fails here rather than in somebody's hand.
    const size = await evaluate<{ w: number; h: number }>(
      `(() => {
        const rect = document.querySelector('#outlineToggle').getBoundingClientRect();
        return { w: rect.width, h: rect.height };
      })()`
    );
    assert.ok(size.w >= 32 && size.h >= 32, `the corner control measures ${String(size.w)}×${String(size.h)}`);
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
