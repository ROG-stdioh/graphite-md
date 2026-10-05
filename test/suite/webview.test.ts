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
 * A document that ends on a short section.
 *
 * The scroll-spy marks the last heading that has passed a line 80px below the
 * pane's top edge, and a heading can only pass it if what follows is tall
 * enough to push it there — which the last heading's own body, one line, never
 * is. The filler above is what makes the page scrollable at all: the rule the
 * test below pins only applies to a pane that has somewhere to scroll to, and
 * a document that fits was already answered for.
 */
const SECTIONS_DOCUMENT = [
  `# ${HEADING}`,
  '',
  ...Array.from({ length: 40 }, (_, i) => `Filler ${i}, one of the lines that makes this page taller than the pane.`),
  '',
  '## First',
  '',
  ...Array.from({ length: 20 }, (_, i) => `More filler ${i}.`),
  '',
  '## Last',
  '',
  'One line under the last heading.',
  '',
].join('\n');

/**
 * A document whose last section holds a subsection.
 *
 * The shape a fold has to be noticed in: the heading a fold takes off the page is
 * the *last* one in the document, so it comes after every heading the reader can
 * still see. A hidden heading measures as a rect of zeros, and a top of 0 is
 * above every reading line — so without the sweep knowing the difference, this is
 * the fixture where the row it lights is for a heading that is not on the page.
 */
const FOLD_LAST_DOCUMENT = [
  `# ${HEADING}`,
  '',
  '## First',
  '',
  ...Array.from({ length: 40 }, (_, i) => `Filler ${i}, under the first section.`),
  '',
  '## Last',
  '',
  '### Nested',
  '',
  ...Array.from({ length: 20 }, (_, i) => `Filler ${i}, under the nested one.`),
  '',
].join('\n');

/**
 * A document where the section holding the reader's heading is the one folded.
 *
 * The stack of filler under the last heading is the point of it: the fold takes
 * most of the document's height out from under the reader, and the pane has to
 * still have somewhere to scroll afterwards. A document that suddenly fits is
 * clamped by the browser, and a clamp is a scroll event the sweep would be woken
 * by anyway — which is the case this test is not about. What it is about is the
 * fold that wakes nobody.
 */
const FOLD_FIRST_DOCUMENT = [
  `# ${HEADING}`,
  '',
  '## First',
  '',
  ...Array.from({ length: 20 }, (_, i) => `Filler ${i}, under the first section.`),
  '',
  '### Nested',
  '',
  ...Array.from({ length: 10 }, (_, i) => `Filler ${i}, under the nested one.`),
  '',
  '## Last',
  '',
  ...Array.from({ length: 200 }, (_, i) => `Filler ${i}, under the last section, keeping the page tall.`),
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

/** An expression that reads the label of the outline row the sweep has lit. */
const ACTIVE_ROW = `(() => {
  const row = document.querySelector('#graphContent .toc-row.active');
  return row ? row.textContent.trim() : null;
})()`;

/** Where two headings ended up, in pixels below the reading pane's top edge. */
interface Placement {
  /** The heading the reader is meant to be on. Negative is above the edge. */
  anchor: number;
  /** A second heading, named by the caller because the arrangement needs it. */
  other: number;
}

/**
 * An expression that scrolls the reading pane until the `anchor` heading sits
 * `at` pixels under the pane's top edge — negative for above it — and answers
 * where both headings ended up against that same edge, which is the line the
 * sweep reads.
 *
 * The numbers come back so the caller can assert the arrangement it needs rather
 * than assume the page took it: the scroll is clamped at both ends, and a pane
 * that could not reach the position asked for would leave the test asserting
 * about a page it never built.
 */
function scrollToHeading(anchor: string, at: number, other: string): string {
  const selector = (id: string): string => JSON.stringify(`[data-target="${id}"].section-head`);
  return `(() => {
    const pane = document.getElementById('contentPane');
    const paneTop = pane.getBoundingClientRect().top;
    const fromTop = (selector) => document.querySelector(selector).getBoundingClientRect().top - paneTop;
    pane.scrollTop += fromTop(${selector(anchor)}) - (${at});
    return { anchor: fromTop(${selector(anchor)}), other: fromTop(${selector(other)}) };
  })()`;
}

/**
 * An expression that folds the section whose heading carries `bodyId`, and reads
 * the lit row in the same expression.
 *
 * One expression on purpose: the fold asks the sweep again in the same turn, so
 * this reads the answer the fold produced rather than one a later frame settled
 * on — and a second round trip would give a re-render a gap to land in.
 */
function foldSection(bodyId: string): string {
  return `(() => {
    document.querySelector('[data-target=${JSON.stringify(bodyId)}].section-head').click();
    const row = document.querySelector('#graphContent .toc-row.active');
    return row ? row.textContent.trim() : null;
  })()`;
}

/** Poll something on the host side of the boundary, where there is no page to ask. */
async function waitForHost(what: string, probe: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!probe()) {
    if (Date.now() >= deadline) assert.fail(`timed out after ${timeoutMs}ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * The expression that puts the preview's own page into a frame the test sizes,
 * and answers what the page made of it.
 *
 * 300x150 is not a size somebody chose: it is what a browser lays a frame out at
 * when it has never been given one, which is the state the preview is written
 * into more often than not — see the guard in src/webviewHtml.ts. Off-screen
 * rather than `display: none`, which would leave the frame with no layout at all,
 * and it is a frame that has been laid out at the wrong size that this is about.
 *
 * `finish` closes the document, and that is the whole difference between the two
 * tests that use this. `load` never fires on a document whose parser is still
 * open, so one test sees the page show itself because the frame was given a size
 * and the other because the page had finished loading — which are the two ways
 * out of the guard, told apart by construction rather than by timing.
 */
function unsizedFrame(id: string, finish: boolean): string {
  return `(() => {
    const frame = document.createElement('iframe');
    frame.id = ${JSON.stringify(id)};
    frame.setAttribute('style', 'position: fixed; left: -10000px; top: 0; width: 300px; height: 150px; border: 0');
    document.body.appendChild(frame);
    void frame.offsetWidth; // lay the frame out before writing into it
    const child = frame.contentDocument;
    // The page's own script is what draws the outline, and a copy that throws on
    // its first line is not the page that was reported. A webview is handed this
    // global by VS Code; a frame inside one is not, and the copy runs in a frame.
    child.defaultView.acquireVsCodeApi = () => ({
      postMessage() {},
      getState() { return undefined; },
      setState() {},
    });
    // The stylesheet is copied in rather than linked, because the link cannot work
    // from here: the media files are served to the webview's own document and the
    // resource service refuses a frame inside it — the sheet arrives in the child
    // cross-origin and unreadable, with none of its rules applied. Measured, not
    // assumed; the first version of this test linked the stylesheet and waited
    // twenty seconds for it. Without the rules the copy is a different document:
    // the same markup laid out as a plain one.
    const sheet = [...document.styleSheets].find((s) => String(s.href).includes('preview.css'));
    const rules = [...sheet.cssRules].map((rule) => rule.cssText).join('\\n');
    child.open();
    // outerHTML carries no doctype, and a document without one is laid out in
    // quirks mode — a different layout from the page's, in ways that reach the
    // numbers this reads.
    child.write('<!DOCTYPE html>' + document.documentElement.outerHTML);
    child.head.insertAdjacentHTML('beforeend', '<style>' + rules + '</style>');
    ${finish ? 'child.close();' : ''}
    return {
      booting: child.documentElement.classList.contains('booting'),
      styled: child.defaultView.getComputedStyle(child.querySelector('.shell')).display === 'flex',
      w: child.defaultView.innerWidth,
      h: child.defaultView.innerHeight,
    };
  })()`;
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

  // The scroll-spy's own hard case, and the one no other layer can reach: it
  // needs a page that really scrolls and really lays out, which the BDD suite
  // and the graph-check double both lack. Scrolling stops when the document's
  // end meets the pane's bottom edge, so the last heading can only pass the
  // reading line if what follows it is at least as tall as the pane — and what
  // follows it here is one line. The sweep alone leaves the highlight on an
  // earlier section for ever; the end-of-scroll rule is what moves it.
  test('lights the last section when the page is scrolled to its end', async () => {
    await preview(await openFixture(SECTIONS_DOCUMENT));

    // The control, and it is not decoration: a page that lit its last row from
    // the first frame would satisfy the wait below without ever scrolling.
    const start = await waitFor<string>('the outline to light a row', ACTIVE_ROW);
    assert.strictEqual(start, 'First', `the highlight started on ${JSON.stringify(start)}`);

    await evaluate(`(() => {
      const pane = document.getElementById('contentPane');
      pane.scrollTop = pane.scrollHeight;
    })()`);

    await waitFor('the highlight to reach the last section', `${ACTIVE_ROW} === 'Last'`);
  });

  // The other half of the fold, and the half that is not geometry: a heading with
  // no box must not win the sweep. Everything under a folded section is
  // `display: none`, an element with no box measures as a rect of zeros, and a
  // top of 0 is above every reading line — so a hidden heading passes the line
  // wherever the reader is, and the last of them wins whenever it comes after the
  // last visible heading that passed. The fixture puts the fold on the last
  // section, which is that arrangement exactly: the row it would light is for a
  // heading nobody can see.
  test('does not light a heading that a fold has hidden', async () => {
    await preview(await openFixture(FOLD_LAST_DOCUMENT));

    const start = await waitFor<string>('the outline to light a row', ACTIVE_ROW);
    assert.strictEqual(start, 'First', `the highlight started on ${JSON.stringify(start)}`);

    // Both numbers are asserted rather than assumed: the first heading has to be
    // above the reading line and the last one below it, or the fold has no wrong
    // answer available to it and the test proves nothing.
    const placed = await evaluate<Placement>(scrollToHeading('body-first', -120, 'body-last'));
    assert.ok(
      placed.anchor < 80,
      `the first heading never reached the reading line, so it was not the answer to begin with: ${JSON.stringify(placed)}`
    );
    assert.ok(
      placed.other > 80,
      `the last heading is already above the reading line, so the reader is not where this test needs them: ${JSON.stringify(placed)}`
    );

    const after = await evaluate<string | null>(foldSection('body-last'));
    assert.strictEqual(
      after,
      'First',
      `the fold moved the highlight onto a heading it had hidden: ${JSON.stringify(after)}`
    );
  });

  // And the fold that takes away the heading the reader is actually on. Nothing
  // asks the sweep again on its own: a fold fires no scroll event, and a browser
  // has no reason to fire one for content that vanished inside the viewport. So
  // without the ask, the highlight keeps a row whose heading is no longer on the
  // page — and the pane goes on saying the reader is somewhere they are not.
  //
  // "Last" rather than "First", and that is the geometry rather than a
  // preference: the fold takes a section's worth of content out from under the
  // reader, everything below it moves up by that much, and the last heading ends
  // up above the reading line. Which heading the reader lands on is the layout's
  // business; that it is one they can see is this test's.
  test('moves the highlight when a fold takes the heading being read away', async () => {
    await preview(await openFixture(FOLD_FIRST_DOCUMENT));

    const start = await waitFor<string>('the outline to light a row', ACTIVE_ROW);
    assert.strictEqual(start, 'First', `the highlight started on ${JSON.stringify(start)}`);

    const placed = await evaluate<Placement>(scrollToHeading('body-nested', 40, 'body-last'));
    assert.ok(
      placed.anchor < 80,
      `the nested heading never reached the reading line, so the reader was not on it: ${JSON.stringify(placed)}`
    );
    assert.ok(
      placed.other > 80,
      `the last heading is already above the reading line, so it is the answer already: ${JSON.stringify(placed)}`
    );

    // Waited for rather than read: the scroll is set from here and the sweep runs
    // when the browser gets round to telling the page about it. This is the step
    // that says the reader is on the nested section — the fold below is the only
    // thing that can take them off it.
    await waitFor('the outline to follow the reader onto the nested section', `${ACTIVE_ROW} === 'Nested'`);

    const after = await evaluate<string | null>(foldSection('body-first'));
    assert.strictEqual(
      after,
      'Last',
      `the highlight stayed on a heading the fold had hidden: ${JSON.stringify(after)}`
    );
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

  // The rule the guard's class answers to, and the half of it that is easy to
  // lose: `display: none` would satisfy any test written for "is it hidden", and
  // would leave the page with nothing to measure — every number the page takes at
  // load, from the panes' heights to where the scrollbar's thumb goes, is 0/0 on
  // a document with no layout. Set by hand here, because the test editor's panel
  // always has a size: this is the state the page is in for the frames between
  // being written and being laid out.
  test('hides the shell while the page is booting, without giving up its layout', async () => {
    await preview(await openFixture(DOCUMENT));

    // The ordinary case first, and the one that has to stay ordinary: a panel
    // that already has a size when the page arrives never keeps the class at all,
    // so the state everything below is about is one no reader is normally in.
    assert.strictEqual(
      await evaluate<boolean>(`document.documentElement.classList.contains('booting')`),
      false,
      'the page is holding itself back in a panel that has a size'
    );

    interface Booting {
      visibility: string;
      overflow: string;
      w: number;
      h: number;
      own: string;
      theme: string;
      canvas: string;
      body: string;
    }
    const booting = await evaluate<Booting>(
      `(() => {
        const root = document.documentElement;
        const own = getComputedStyle(document.body).backgroundColor;
        // Measured through an element rather than read as a string, so that
        // whatever notation this engine resolves a theme colour to is the
        // notation the comparison below is made in.
        const probe = document.createElement('div');
        probe.style.background = 'var(--vscode-editor-background)';
        document.body.appendChild(probe);
        const theme = getComputedStyle(probe).backgroundColor;
        probe.remove();
        root.classList.add('booting');
        const shell = document.querySelector('.shell');
        const rect = shell.getBoundingClientRect();
        return {
          visibility: getComputedStyle(shell).visibility,
          overflow: getComputedStyle(root).overflow,
          w: rect.width,
          h: rect.height,
          own,
          theme,
          canvas: getComputedStyle(root).backgroundColor,
          body: getComputedStyle(document.body).backgroundColor,
        };
      })()`
    );
    assert.strictEqual(booting.visibility, 'hidden', 'the shell is still drawn while the page is booting');
    assert.ok(
      booting.w > 0 && booting.h > 0,
      `the booting page has no layout left to measure: the shell is ${booting.w}x${booting.h}`
    );
    assert.strictEqual(booting.overflow, 'hidden', 'the booting page can still be scrolled');

    // And the half of this that hiding the shell does not cover, which is the
    // half a reader sees: a page whose shell is hidden is still a rectangle of
    // the page's own `--bg` wherever the frame happens to be, and the frame is
    // 300x150 until the panel arrives. Holding the shell back and painting the
    // background anyway is a small dark box in the corner that grows — the
    // report this guard was written for, still there with the first fix in.
    assert.notStrictEqual(
      booting.theme,
      'rgba(0, 0, 0, 0)',
      'this editor injects no --vscode-editor-background, so the booting page has only its own colour to paint with'
    );
    assert.strictEqual(
      booting.canvas,
      booting.theme,
      `the booting page is painted with its own background rather than the panel's: ${booting.canvas} against ${booting.theme}`
    );
    assert.strictEqual(
      booting.body,
      booting.theme,
      `the booting page's body is painted with its own background, so the frame draws a box: ${booting.body}`
    );
    assert.notStrictEqual(
      booting.theme,
      booting.own,
      'the panel and the page are the same colour here, so this test cannot tell which one is being painted'
    );

    const shown = await evaluate<{ visibility: string; overflow: string; canvas: string; own: string }>(
      `(() => {
        const root = document.documentElement;
        root.classList.remove('booting');
        const shell = document.querySelector('.shell');
        return {
          visibility: getComputedStyle(shell).visibility,
          overflow: getComputedStyle(root).overflow,
          canvas: getComputedStyle(root).backgroundColor,
          own: getComputedStyle(document.body).backgroundColor,
        };
      })()`
    );
    assert.strictEqual(shown.visibility, 'visible', 'the page stayed hidden once it stopped booting');
    assert.notStrictEqual(shown.overflow, 'hidden', 'the page still refuses to scroll once it stopped booting');
    // Transparent on the root is the page back to its ordinary state, and not an
    // oversight: with nothing on `html`, the body's background propagates to the
    // canvas, which is how the page is painted with `--bg` at all — and it is the
    // reason the booting page has to say something on `html` to stop it.
    assert.strictEqual(
      shown.canvas,
      'rgba(0, 0, 0, 0)',
      `the page is still painted with the panel's colour after it stopped booting: ${shown.canvas}`
    );
    assert.strictEqual(shown.own, booting.own, 'the page did not go back to its own background once it stopped booting');
  });

  // The bug the guard exists for: VS Code hands the panel its document before
  // the panel around it has been laid out, so the page is written into a frame
  // with no size of its own, laid out at 300x150 — where the outline, a fixed
  // 300px that will not shrink, is the whole viewport and the reading pane
  // collapses to nothing. The panel in the test editor is always born at its real
  // size, so this state cannot be reached by opening a preview here. It is built
  // instead, out of the page's own markup.
  test('holds the page back in a frame with no size, and shows it when the frame gets one', async () => {
    await preview(await openFixture(DOCUMENT));

    const held = await evaluate<{ booting: boolean; styled: boolean; w: number; h: number }>(
      unsizedFrame('unsizedFrame', false)
    );
    assert.ok(held.styled, 'the copy came out with no stylesheet, so nothing about its layout can be measured');
    assert.ok(
      held.booting,
      `the page was not held back in a frame with no size of its own: the frame measured ${held.w}x${held.h}`
    );

    // And the state is worth holding back from — the claim the rule in
    // preview.css rests on, measured rather than assumed. At 300px the outline
    // (a fixed 300px that will not shrink) is the whole viewport, the reading
    // pane collapses to nothing, and the page runs wider than the frame it is in,
    // so the browser draws a scrollbar along the bottom of a page nobody can read
    // yet. That bar is in the report this guard was written for.
    const overflow = await evaluate<{ scrollW: number; innerW: number; bareH: number; heldH: number; innerH: number }>(
      `(() => {
        const child = document.getElementById('unsizedFrame').contentDocument;
        const root = child.documentElement;
        const heldHeight = root.clientHeight;
        root.classList.remove('booting');
        const bareHeight = root.clientHeight;
        root.classList.add('booting');
        return {
          scrollW: root.scrollWidth,
          innerW: child.defaultView.innerWidth,
          bareH: bareHeight,
          heldH: heldHeight,
          innerH: child.defaultView.innerHeight,
        };
      })()`
    );
    // Two guards before the claim, both of them about this test rather than about
    // the page: a fixture that does not overflow has no scrollbar to hold back,
    // and neither does one that never drew a bar in the first place — in either
    // case the assertion below would pass on any document at all.
    assert.ok(
      overflow.scrollW > overflow.innerW,
      `the page does not overflow a 300px frame, so there is no scrollbar to hold back: ${JSON.stringify(overflow)}`
    );
    assert.ok(
      overflow.bareH < overflow.innerH,
      `the page at 300px drew no scrollbar for the rule to take away: ${JSON.stringify(overflow)}`
    );
    assert.strictEqual(
      overflow.heldH,
      overflow.innerH,
      `the page kept its scrollbar while it was booting: ${JSON.stringify(overflow)}`
    );

    // Then the frame is given a size, which is the signal the panel's own arrival
    // sends.
    //
    // Waited for by polling the page's state rather than by drawing frames inside
    // it, which is a workaround for this fixture and not for the page. The frame
    // is parked off-screen (it would otherwise sit on top of the preview), and
    // Chromium gives an off-screen frame one rendering opportunity and then stops
    // scheduling them — measured here, not assumed: a first child-side
    // `requestAnimationFrame` resolves, a second one never does. So a test that
    // awaits frames inside that frame hangs on the second, which is exactly what
    // this did before. Polling the class is sound for the same measurement: the
    // parser is still open in this fixture, so `load` cannot fire and the resize
    // is the only way out.
    await evaluate(`document.getElementById('unsizedFrame').style.width = '800px'`);
    await waitFor(
      'the page to stop waiting once its frame has a size',
      `!document.getElementById('unsizedFrame').contentDocument.documentElement.classList.contains('booting')`
    );
    const shown = await evaluate<{ booting: boolean; w: number }>(
      `(() => {
        const child = document.getElementById('unsizedFrame').contentDocument;
        return { booting: child.documentElement.classList.contains('booting'), w: child.defaultView.innerWidth };
      })()`
    );
    assert.ok(!shown.booting, 'the page is still held back after its frame was given a size');
    assert.ok(shown.w > held.w, `the frame was never actually given a size: ${held.w} → ${shown.w}`);
  });

  // And the way out that keeps a page from being stuck hidden for good: a panel
  // that really is 300x150 never sends that resize, so the page stops waiting
  // when it has finished loading. The frame is closed here and never resized, so
  // the load event is the only thing that can take the class off — which is what
  // makes this the test of that escape rather than of the other one.
  test('shows itself once it has loaded, in a frame that is never given a size', async () => {
    await preview(await openFixture(DOCUMENT));

    const held = await evaluate<{ booting: boolean }>(unsizedFrame('unsizedFrame', true));
    assert.ok(held.booting, 'the page was not held back in a frame with no size of its own');

    await waitFor(
      'the page to stop waiting for a size it is never going to get',
      `!document.getElementById('unsizedFrame').contentDocument.documentElement.classList.contains('booting')`
    );
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
