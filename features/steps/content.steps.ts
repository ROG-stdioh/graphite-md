// Steps for what a document's content turns into: inline syntax, task lists,
// math, diagrams, code blocks, links, and the policy on the page the preview
// loads.
//
// Every content assertion reads the parsed document rather than a pattern over
// `this.html`. A string cannot be asked a structural question — whether an
// element holds *this* text, whether it sits inside a code fence, whether a
// heading is a heading — and the scenarios that could not fail were all of
// them assertions of exactly that shape. The parser is in ../lib/html.
//
// See document.steps.ts for why every step takes a world type argument and
// every parameter an annotation.
import type { DataTable } from '@cucumber/cucumber';
import type * as Html from '../lib/html';
import type { PreviewWorld } from '../support/world';

const {
  allElements,
  attrOf,
  byClass,
  byTag,
  classesOf,
  commentsIn,
  firstTag,
  parseHtml,
  textOf,
}: typeof Html = require('../lib/html.ts') as typeof Html;

const assert: typeof import('assert') = require('assert') as typeof import('assert');
const { Given, Then } = require('@cucumber/cucumber') as typeof import('@cucumber/cucumber');

// ---- inline syntax -------------------------------------------------------

/**
 * The text every `<tag>` in the preview holds, in document order.
 *
 * A list rather than a boolean so a failure can name what was there instead.
 * "No `<sup>` element at all" and "a `<sup>` holding something else" are
 * different faults — a missing plugin against a mis-wired one — and a message
 * that says only what was expected leaves the reader to find out which by hand.
 */
function heldBy(html: string, tag: string): string[] {
  return byTag(parseHtml(html), tag).map((el) => textOf(el));
}

// Exact text, not a substring: `<sup>20</sup>` is not what a scenario asking
// for "2" means, and the old pattern got that right — what it could not do was
// tell one tag from another, which is why the superscript and subscript
// scenarios passed with the two plugins exchanged.
Then<PreviewWorld>('the preview shows {string} as superscript', function (text: string) {
  const held = heldBy(this.html, 'sup');
  assert.ok(
    held.includes(text),
    `expected "${text}" in a <sup>; the page's <sup> elements hold ${JSON.stringify(held)}`
  );
});

Then<PreviewWorld>('the preview shows {string} as subscript', function (text: string) {
  const held = heldBy(this.html, 'sub');
  assert.ok(
    held.includes(text),
    `expected "${text}" in a <sub>; the page's <sub> elements hold ${JSON.stringify(held)}`
  );
});

Then<PreviewWorld>('the preview underlines {string}', function (text: string) {
  const held = heldBy(this.html, 'ins');
  assert.ok(
    held.includes(text),
    `expected "${text}" underlined; the page's <ins> elements hold ${JSON.stringify(held)}`
  );
});

Then<PreviewWorld>('the preview highlights {string}', function (text: string) {
  const held = heldBy(this.html, 'mark');
  assert.ok(
    held.includes(text),
    `expected "${text}" highlighted; the page's <mark> elements hold ${JSON.stringify(held)}`
  );
});

Then<PreviewWorld>('the preview strikes through {string}', function (text: string) {
  const held = heldBy(this.html, 's');
  assert.ok(
    held.includes(text),
    `expected "${text}" struck through; the page's <s> elements hold ${JSON.stringify(held)}`
  );
});

// Exact text, like the three above: the claim is which element holds it, and a
// fenced block's own `<code>` holds the whole block rather than this span, so
// an exact match reads the inline case without naming `pre > code`.
Then<PreviewWorld>('the preview shows {string} as inline code', function (text: string) {
  const held = heldBy(this.html, 'code');
  assert.ok(
    held.includes(text),
    `expected "${text}" in a <code>; the page's <code> elements hold ${JSON.stringify(held)}`
  );
});

// ---- emphasis ------------------------------------------------------------
// `<em>` and `<strong>` were asserted nowhere in this repo. Every document is
// mostly emphasis and links, and the whole pair of tags — which spelling of the
// marker produces which, and that a doubled marker is not two singles — went
// unwatched.

Then<PreviewWorld>('the preview shows {string} in italics', function (text: string) {
  const held = heldBy(this.html, 'em');
  assert.ok(
    held.includes(text),
    `expected "${text}" in an <em>; the page's <em> elements hold ${JSON.stringify(held)}`
  );
});

Then<PreviewWorld>('the preview shows {string} in bold', function (text: string) {
  const held = heldBy(this.html, 'strong');
  assert.ok(
    held.includes(text),
    `expected "${text}" in a <strong>; the page's <strong> elements hold ${JSON.stringify(held)}`
  );
});

/**
 * `inner` in an `<innerTag>` inside an `<outerTag>` whose own text is `outer`.
 *
 * Read through the outer element rather than over the whole page, because "the
 * italic is inside the bold" is the claim and a document that holds both tags
 * side by side satisfies anything asked of the page as a whole.
 */
function expectNested(
  html: string,
  innerTag: string,
  inner: string,
  outerTag: string,
  outer: string
): void {
  const outers = byTag(parseHtml(html), outerTag).filter((el) => textOf(el) === outer);
  assert.ok(
    outers.length > 0,
    `expected a <${outerTag}> holding exactly ${JSON.stringify(outer)}; the page's <${outerTag}> ` +
      `elements hold ` + JSON.stringify(heldBy(html, outerTag))
  );
  const nested = outers.flatMap((el) => byTag(el, innerTag)).map((el) => textOf(el));
  assert.ok(
    nested.includes(inner),
    `expected ${JSON.stringify(inner)} in a <${innerTag}> inside that <${outerTag}>; it holds ` +
      JSON.stringify(nested)
  );
}

// Both directions, because they are two different renderings of `***x***`:
// markdown-it reads the triple marker as bold inside italics, and a renderer
// that crossed the two would satisfy "both tags hold the text" either way.
Then<PreviewWorld>('the preview shows {string} in bold inside the italics {string}', function (
  inner: string,
  outer: string
) {
  expectNested(this.html, 'strong', inner, 'em', outer);
});

Then<PreviewWorld>('the preview shows {string} in italics inside the bold {string}', function (
  inner: string,
  outer: string
) {
  expectNested(this.html, 'em', inner, 'strong', outer);
});

// The claim is about the *only* italics on the page, which is what makes it a
// control as well as an assertion. A scenario whose subject is "this underscore
// is not emphasis" is satisfied by a renderer that emits no `<em>` at all, so
// the same document carries one real emphasis and this step is what says so.
//
// The whole list, not a membership test: two italics where the document wrote
// one is the failure a naive `_` rule produces, and membership would not see it.
Then<PreviewWorld>('the italics on the page are exactly {string}', function (expected: string) {
  const held = heldBy(this.html, 'em');
  assert.deepStrictEqual(
    held,
    [expected],
    '\n  italics mismatch\n  expected exactly: ' + JSON.stringify([expected]) +
      '\n  actual:           ' + JSON.stringify(held)
  );
});

// ---- the typographer ------------------------------------------------------

Given<PreviewWorld>('the typographer is on', function () {
  this.typographer = true;
});

Given<PreviewWorld>('the typographer is off', function () {
  this.typographer = false;
});

// ---- footnotes -----------------------------------------------------------

/**
 * The words of a footnote, with the little `↩` link back to the sentence left
 * out. It is chrome the plugin adds rather than anything the author wrote, and
 * reading it in would put a return arrow in the middle of every expected cell.
 */
function noteText(item: Html.El): string {
  const skip = (node: Html.Root): string => {
    let text = '';
    for (const child of node.childNodes) {
      if ('tagName' in child) {
        if (classesOf(child).includes('footnote-backref')) continue;
        text += skip(child);
      } else if (child.nodeName === '#text') {
        text += child.value;
      }
    }
    return text;
  };
  return skip(item).trim();
}

// The half the scenario's own name claims — "at the foot" says where, and the
// numbering says *which* note is which, which is the part a reader would notice
// being wrong. A footnote list is numbered by the order the sentences cite it,
// not by the order the definitions were written, so a document that defines its
// notes out of order has to come out renumbered.
//
// One table for both, because they are one claim: the label the reader sees in
// the prose and the words they find at the foot are two halves of the same row.
Then<PreviewWorld>('the notes are numbered in the order they are first cited:', function (
  dataTable: DataTable
) {
  const expected = dataTable.hashes().map((row) => ({
    label: row.label ?? '',
    note: row.note ?? '',
  }));

  const root = parseHtml(this.html);
  const refs = byClass(root, 'footnote-ref');
  assert.ok(refs.length > 0, 'the document produced no citations at all, so this scenario proves nothing');

  // By id rather than by position, because the href is the claim: a citation
  // that pointed at the wrong note would still sit in the right place in the
  // list.
  const notesById = new Map<string, Html.El>();
  for (const item of byClass(root, 'footnote-item')) {
    const id = attrOf(item, 'id');
    if (id !== undefined) notesById.set(id, item);
  }

  const actual: { label: string; note: string }[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const anchor = firstTag(ref, 'a');
    const label = anchor === null ? '' : textOf(anchor);
    const target = (anchor === null ? undefined : attrOf(anchor, 'href'))?.replace(/^#/, '') ?? '';
    // A note cited by a second sentence is the same row, not a new one — the
    // second citation is labelled `[1:1]` and would otherwise read as a second
    // note. Keyed by the note rather than by the label for exactly that reason.
    if (seen.has(target)) continue;
    seen.add(target);
    const note = notesById.get(target);
    actual.push({ label, note: note === undefined ? '<no note with that id>' : noteText(note) });
  }

  assert.deepStrictEqual(
    actual,
    expected,
    '\n  footnote mismatch\n  expected: ' + JSON.stringify(expected) +
      '\n  actual:   ' + JSON.stringify(actual)
  );
});

// The one cited note is the control: "the definition that was never cited is
// not shown" is satisfied by a renderer that shows no notes at all, and the
// scenario using this asserts the cited one is there.
Then<PreviewWorld>('the preview shows {int} notes', function (expected: number) {
  const found = byClass(parseHtml(this.html), 'footnote-item').length;
  assert.strictEqual(found, expected, `expected ${expected} notes at the foot, found ${found}`);
});

Then<PreviewWorld>('the note is rendered at the foot of the page', function () {
  const footnotes = byClass(parseHtml(this.html), 'footnotes');
  assert.ok(footnotes.length > 0, 'expected a footnotes section');
  const refs = byClass(parseHtml(this.html), 'footnote-ref');
  assert.ok(refs.length > 0, 'expected a reference in the body');
});

Then<PreviewWorld>('the note links back to the sentence that cited it', function () {
  const root = parseHtml(this.html);
  const back = allElements(root).filter(
    (el) => el.tagName === 'a' && classesOf(el).includes('footnote-backref')
  );
  assert.ok(back.length > 0, 'expected a back-reference from the note to its citation');

  // The href rather than a pattern over the raw HTML, so the id is read out of
  // the attribute the browser will follow instead of one that happens to sit
  // near it in the source.
  const ids = new Set(allElements(root).map((el) => attrOf(el, 'id')).filter(Boolean));
  for (const anchor of back) {
    const href = attrOf(anchor, 'href') ?? '';
    assert.ok(href.startsWith('#'), `a back-reference points at ${JSON.stringify(href)}, not an id`);
    assert.ok(
      ids.has(href.slice(1)),
      `the note points back at ${JSON.stringify(href)}, which is not in the document`
    );
  }
});

// ---- task lists ----------------------------------------------------------

function taskItems(html: string): { checked: boolean; line: number | null }[] {
  return byClass(parseHtml(html), 'task-checkbox').map((el) => {
    // Parsed rather than trusted: the attribute is written by the renderer and
    // read by the host's write-back, and `data-line=""` or `data-line="x"`
    // would otherwise arrive as a number and be checked as though it were one.
    const parsed = Number.parseInt(attrOf(el, 'data-line') ?? '', 10);
    return {
      checked: classesOf(el).includes('checked'),
      line: Number.isInteger(parsed) ? parsed : null,
    };
  });
}

function expectTaskItems(this: PreviewWorld, expected: number): void {
  const found = taskItems(this.html).length;
  assert.strictEqual(found, expected, `expected ${expected} task items, found ${found}`);
}

// A step expression has no optional plural, and "1 task items" reads wrong, so
// the singular is registered beside the plural rather than bending the
// scenario's English to suit the matcher.
Then<PreviewWorld>('the preview shows {int} task items', expectTaskItems);
Then<PreviewWorld>('the preview shows {int} task item', expectTaskItems);

Then<PreviewWorld>('{int} of them are ticked', function (expected: number) {
  const found = taskItems(this.html).filter((t) => t.checked).length;
  assert.strictEqual(found, expected, `expected ${expected} ticked, found ${found}`);
});

// Clicking a checkbox rewrites that line of the file, so a checkbox with no
// source line is one that cannot be clicked.
Then<PreviewWorld>('every task item knows which line of the file it came from', function () {
  for (const item of taskItems(this.html)) {
    assert.notStrictEqual(item.line, null, 'a task item has no source line to write back to');
  }
});

// The stronger half of the same contract, and the one that was missing: a box
// carrying a line is not the same as a box carrying the *right* line. When
// stripping an HTML comment also stripped its line breaks, every box still
// carried a line and every one of them pointed at the wrong text — so clicking
// a box did nothing, and nothing said so. The matcher comes from the host's
// own module rather than a copy of the rule, so this checks the two halves
// agree instead of checking a rule against itself.
const { taskMarkerColumn } = require('../../src/taskMarker.ts') as typeof import('../../src/taskMarker');

Then<PreviewWorld>('every checkbox can be toggled in the source file', function () {
  const lines = this.source.split(/\r?\n/);
  const items = taskItems(this.html);
  assert.ok(items.length > 0, 'no task items rendered, so this scenario proves nothing');

  for (const item of items) {
    if (item.line === null) assert.fail('a task item carries no source line at all');

    const text = lines[item.line];
    if (text === undefined) assert.fail(`line ${item.line} is not a line of this document`);

    const column = taskMarkerColumn(text);
    if (column === undefined) {
      assert.fail(
        `this box points at line ${item.line}, where the host finds no checkbox: ${JSON.stringify(text)}`
      );
    }

    assert.match(
      text.slice(column, column + 3),
      /^\[[ xX]\]$/,
      `clicking this box would rewrite ${JSON.stringify(text.slice(column, column + 3))} rather than the box, in ${JSON.stringify(text)}`
    );
  }
});

// ---- math ----------------------------------------------------------------

Then<PreviewWorld>('the preview renders it as math', function () {
  assert.ok(byClass(parseHtml(this.html), 'katex').length > 0, 'expected KaTeX output');
});

// How many formulas, which is what tells "this is maths" apart from "this is the
// maths I wrote and nothing else is". A dollars-delimited renderer is one bad
// rule away from reading a price as an opening delimiter, and a page with the
// right formula on it looks identical either way until you count.
function expectMaths(this: PreviewWorld, expected: number): void {
  const found = byClass(parseHtml(this.html), 'katex').length;
  assert.strictEqual(found, expected, `expected ${expected} piece(s) of maths, found ${found}`);
}
Then<PreviewWorld>('the preview typesets {int} pieces of math', expectMaths);
Then<PreviewWorld>('the preview typesets {int} piece of math', expectMaths);

// The half of the count that the count cannot see. A `$…$` KaTeX refused is a
// `katex-error` span and *not* a `katex` one, so a page where the reader's prose
// was handed to KaTeX and came back as a red error box passes `expectMaths`
// untouched. Kept as its own step rather than folded into the count, because the
// malformed-maths scenario wants the opposite assertion and would have to opt
// out of it.
Then<PreviewWorld>('the preview marks no math as bad', function () {
  const flagged = byClass(parseHtml(this.html), 'katex-error').length;
  assert.strictEqual(flagged, 0, `expected no KaTeX errors, found ${flagged}`);
});

// The TeX the reader's formula was written in, read back off KaTeX's own
// annotation element. The step above says something typeset; this says *what*,
// and the two failures it separates are a formula that rendered as the wrong
// formula and a `$…$` that never became maths at all — both of which leave a
// page with KaTeX output on it.
//
// Trimmed, because display maths keeps the newlines that surrounded it in the
// source and no scenario wants to write those down.
Then<PreviewWorld>('the math typeset on the page reads {string}', function (expected: string) {
  const annotations = byTag(parseHtml(this.html), 'annotation').map((el) => textOf(el).trim());
  assert.ok(
    annotations.includes(expected),
    `expected the maths ${JSON.stringify(expected)} on the page; KaTeX was handed ` +
      JSON.stringify(annotations)
  );
});

// `renders it as math` and this are not the same claim, and the difference is
// the half that gets forgotten: display-mode output wraps a `.katex` span, so
// every assertion of the weaker step is satisfied by a renderer that made all
// maths display. This is the one that says the delimiters went to the right
// places.
Then<PreviewWorld>('the preview renders it as inline math', function () {
  const root = parseHtml(this.html);
  assert.ok(byClass(root, 'katex').length > 0, 'expected KaTeX output');
  const display = byClass(root, 'katex-display').length;
  assert.strictEqual(display, 0, `expected inline maths, found ${display} in display mode`);
});

Then<PreviewWorld>('the preview renders it as displayed math', function () {
  assert.ok(
    byClass(parseHtml(this.html), 'katex-display').length > 0,
    'expected display-mode KaTeX output'
  );
});

// The claim #41 is about, and the one `shows the text` cannot make: the page
// can read correctly while the markup the renderer produced does not say what
// the sentence was. Both strings are asserted against the *same* `<p>`, so a
// repair that wrapped the tail in a paragraph of its own — the sentence still
// split, which is what the browser's error recovery did — fails here.
Then<PreviewWorld>('a single paragraph holds both {string} and {string}', function (first: string, second: string) {
  const root = parseHtml(this.html);
  const holding = byTag(root, 'p').filter((p) => {
    const text = textOf(p);
    return text.includes(first) && text.includes(second);
  });
  assert.ok(
    holding.length > 0,
    `expected one paragraph to hold both ${JSON.stringify(first)} and ${JSON.stringify(second)}; ` +
      `the paragraphs read ${JSON.stringify(byTag(root, 'p').map((p) => textOf(p)))}`
  );
});

Then<PreviewWorld>('the bad math is marked rather than breaking the page', function () {
  assert.ok(
    byClass(parseHtml(this.html), 'katex-error').length > 0,
    'expected the malformed maths to be flagged'
  );
});

Then<PreviewWorld>('the render still produced a page', function () {
  assert.ok(this.html.length > 0, 'the renderer returned nothing');
});

// ---- diagrams ------------------------------------------------------------

Then<PreviewWorld>('the preview renders a diagram', function () {
  assert.ok(
    byClass(parseHtml(this.html), 'mermaid').length > 0,
    'expected a mermaid container'
  );
});

Then<PreviewWorld>('the diagram is handed its source to draw', function () {
  const container = byClass(parseHtml(this.html), 'mermaid')[0];
  assert.ok(container, 'expected a mermaid container');
  const source = textOf(container).trim();
  assert.ok(source.length > 0, 'the mermaid container was handed nothing to draw');
});

// ---- code blocks ---------------------------------------------------------

/** Every class highlight.js puts on its own output, on any element. */
function highlightClasses(html: string): string[] {
  return allElements(parseHtml(html))
    .flatMap((el) => classesOf(el))
    .filter((name) => name === 'hljs' || name.startsWith('hljs-'));
}

Then<PreviewWorld>('the code is syntax highlighted', function () {
  const classes = highlightClasses(this.html);
  assert.ok(classes.includes('hljs'), 'expected a highlighted <pre>, and none reached the page');
  assert.ok(
    classes.some((name) => name.startsWith('hljs-')),
    `expected highlight.js spans inside it, found only ${JSON.stringify(classes)}`
  );
});

// By class rather than by substring over the page: a document that merely
// *mentions* highlight.js is not highlighted output, and the old check could
// not tell the two apart.
Then<PreviewWorld>('the code is shown without highlighting', function () {
  assert.deepStrictEqual(
    highlightClasses(this.html),
    [],
    'expected no highlighting, but highlight.js classes were present'
  );
});

// Scoped to the code blocks themselves, which is what "the code shows" claims.
// The old version decoded entities across the whole page and searched it, so
// `literal` was satisfied by the text landing anywhere at all — including as a
// paragraph, which is the failure this is supposed to catch.
Then<PreviewWorld>('the code shows the literal text {string}', function (expected: string) {
  const blocks = byTag(parseHtml(this.html), 'pre').map((el) => textOf(el));
  assert.ok(
    blocks.length > 0,
    'the document rendered no code block at all, so this scenario proves nothing'
  );
  assert.ok(
    blocks.some((text) => text.includes(expected)),
    `expected a code block to show ${JSON.stringify(expected)}; the code blocks hold ${JSON.stringify(blocks)}`
  );
});

// ---- links ---------------------------------------------------------------

/** Every link the preview produced, as { href, text }. */
function anchors(html: string): { href: string; text: string }[] {
  return byTag(parseHtml(html), 'a').map((el) => ({
    href: attrOf(el, 'href') ?? '',
    text: textOf(el).trim(),
  }));
}

Then<PreviewWorld>('{string} is not turned into a link', function (text: string) {
  const hit = anchors(this.html).find((a) => a.text === text);
  // The message is built before assert.ok runs, so `hit` is still nullable here
  // — which is the only reason the link that was found can be named in it.
  assert.ok(!hit, `expected "${text}" to stay plain text, but it linked to ${hit?.href ?? ''}`);
});

Then<PreviewWorld>('{string} is a link to {string}', function (text: string, href: string) {
  const hit = anchors(this.html).find((a) => a.text === text);
  assert.ok(hit, `expected "${text}" to become a link`);
  assert.strictEqual(hit.href, href, `"${text}" linked to ${hit.href}, expected ${href}`);
});

Then<PreviewWorld>('{string} is an email link', function (text: string) {
  const hit = anchors(this.html).find((a) => a.text === text);
  assert.ok(hit, `expected "${text}" to become a link`);
  assert.ok(hit.href.startsWith('mailto:'), `expected a mailto: link, got ${hit.href}`);
});

// ---- raw HTML ------------------------------------------------------------
//
// Raw HTML renders, so nothing here asserts that markup is *absent* — that
// would be asserting the bug. What it asserts is that the markup arrives and
// that the page the webview loads refuses to act on it. The renderer's half is
// the parsed document; the page's half is the policy in src/webviewHtml.ts,
// built by the real module rather than a copy of it.
//
// Read off the parse rather than matched in the string, because the two are not
// the same claim. A `<script src=…>` written inside an HTML comment is text as
// far as a browser is concerned — the comment is hidden and nothing loads — and
// the pattern this replaced found it and called it live markup. Which is the
// direction that matters here: the check would have passed for a document whose
// script was commented out.

// The count of an element, which is the shape most of the escaping claims need.
// "at least one `<b>`" is satisfied by a renderer that escaped nothing as well
// as by one that escaped everything — the point of these scenarios is usually
// that a tag is live in one place on the page and *only* in that place, and
// that is a count.
function expectElements(this: PreviewWorld, expected: number, tag: string): void {
  const found = byTag(parseHtml(this.html), tag).length;
  const message =
    expected === 0
      ? `expected no <${tag}> element, but ${found} reached the page`
      : `expected ${expected} <${tag}> element(s), found ${found}`;
  assert.strictEqual(found, expected, message);
}
Then<PreviewWorld>('the preview shows {int} {word} elements', expectElements);
Then<PreviewWorld>('the preview shows {int} {word} element', expectElements);

// The whole page's text, exactly. `the preview shows the text` is a containment
// test, which cannot see the failure this is for: a document whose `&amp;` was
// escaped twice reads `&amp;`, and that string contains the `&` the scenario
// asked for.
Then<PreviewWorld>("the preview's text is exactly {string}", function (expected: string) {
  const text = textOf(parseHtml(this.html)).trim();
  assert.strictEqual(text, expected, `the page reads ${JSON.stringify(text)}`);
});

Then<PreviewWorld>('the {word} element is passed through as markup', function (tag: string) {
  const found = byTag(parseHtml(this.html), tag).length;
  assert.ok(
    found > 0,
    `expected a live <${tag}> element in the rendered HTML, but no such element reached the page — the tag came through as text`
  );
});

Then<PreviewWorld>('the {word} attribute is passed through as markup', function (name: string) {
  const carrying = allElements(parseHtml(this.html)).filter(
    (el) => attrOf(el, name) !== undefined
  );
  assert.ok(
    carrying.length > 0,
    `expected a live ${name}= attribute in the rendered HTML, but no element carries one — it came through escaped`
  );
});

Then<PreviewWorld>('the comment saying {string} reaches the page as a real comment', function (text: string) {
  const root = parseHtml(this.html);
  const comments = commentsIn(root);
  assert.ok(
    comments.some((comment) => comment.includes(text)),
    `expected ${JSON.stringify(text)} inside a real HTML comment; the page carries ${JSON.stringify(comments)}`
  );
  assert.ok(
    !textOf(root).includes('<!--'),
    'a comment came through escaped, so a reader would see the markup rather than the page hiding it'
  );
});

// ---- the page's policy ---------------------------------------------------

Given<PreviewWorld>('remote images are on', function () {
  this.remoteImages = true;
});

Given<PreviewWorld>('remote images are off', function () {
  this.remoteImages = false;
});

/**
 * The policy out of one page, or a failure naming what is missing.
 *
 * Takes the page rather than the world so a step reads the policy and the
 * markup it governs off the same build. Two calls to `buildPage()` are two
 * pages, and the second one's nonce is not the first one's.
 *
 * A missing policy asserts rather than throws: a page with no policy at all is
 * exactly the failure these scenarios exist to catch, and it should read as a
 * failed assertion naming what is absent, not as a crash in the harness.
 */
function policyIn(page: string): string {
  const tag = /<meta http-equiv="Content-Security-Policy"[^>]*>/i.exec(page)?.[0];
  assert.ok(tag, 'the page carries no Content-Security-Policy meta tag at all');
  const content = /content="([^"]*)"/.exec(tag)?.[1];
  assert.ok(content, `the policy meta tag carries no content attribute: ${tag}`);
  return content;
}

/**
 * One directive's value, with the directive name stripped.
 *
 * The `(?:^|;\s*)` anchor is what keeps `script-src` from matching inside
 * `default-src` — the two differ by one character and a substring search would
 * report the wrong one.
 */
function directive(policy: string, name: string): string {
  const m = new RegExp(`(?:^|;\\s*)${name}((?:\\s[^;]*)?)`).exec(policy);
  assert.ok(m, `the policy has no ${name} directive: ${policy}`);
  return (m[1] ?? '').trim();
}

/** A directive's admitted sources, as a list. */
function sourcesOf(policy: string, name: string): string[] {
  return directive(policy, name).split(/\s+/).filter(Boolean);
}

Then<PreviewWorld>('the page allows scripts only from a nonce it issued itself', function () {
  const page = this.buildPage();
  const scriptSrc = directive(policyIn(page), 'script-src');

  // Either of these turns the policy into decoration: 'unsafe-inline' lets the
  // document's own <script> and onclick= run, and 'unsafe-eval' lets it run a
  // string as code however the string got there.
  assert.ok(
    !/'unsafe-inline'/.test(scriptSrc),
    `script-src allows inline scripts, so raw HTML in a document would run: script-src ${scriptSrc}`
  );
  assert.ok(
    !/'unsafe-eval'/.test(scriptSrc),
    `script-src allows eval, so a document could execute a string as code: script-src ${scriptSrc}`
  );

  const nonces = [...scriptSrc.matchAll(/'nonce-([A-Za-z0-9]+)'/g)].map((m) => m[1] ?? '');
  assert.strictEqual(
    nonces.length,
    1,
    `script-src should name exactly one nonce, found ${nonces.length}: script-src ${scriptSrc}`
  );
  const [nonce] = nonces;
  assert.ok(nonce, 'script-src named a nonce with no value');

  // A policy naming a nonce is only half of it. The page's own scripts have to
  // carry that same nonce, or the policy is signed with a key nothing holds and
  // the preview's own code is refused alongside the document's — a blank panel
  // with a policy that looks correct in the source.
  //
  // Every script the *page* loads, rather than the two this used to name.
  // Naming them made the scenario assert the composer's shape as well as the
  // policy's: mermaid is emitted only for a document with a diagram to draw
  // (the gate in src/webviewHtml.ts), so a document without one has no mermaid
  // tag and this failed for a page whose policy was perfectly correct. It would
  // also have covered a third script by neither the list nor a count.
  //
  // "The page's" is the load-bearing word, and it is read off the markup rather
  // than assumed: the page puts the rendered document inside one element, and a
  // `<script src=…>` written in that document is the very thing the policy
  // exists to refuse. A loop over every script with a src would demand the
  // nonce on that one too, and fail for a page whose policy was right.
  const root = parseHtml(page);
  const documentBody = allElements(root).find((el) => attrOf(el, 'id') === 'contentInner');
  assert.ok(documentBody, 'the page does not carry the element the document is rendered into');
  const inDocument = new Set(allElements(documentBody));

  const scripts = byTag(root, 'script').filter(
    (el) => attrOf(el, 'src') !== undefined && !inDocument.has(el)
  );
  assert.ok(scripts.length > 0, 'the page loads no scripts at all, so the loop below proves nothing');
  for (const tag of scripts) {
    const src = attrOf(tag, 'src') ?? '';
    assert.ok(
      (attrOf(tag, 'nonce') ?? '') === nonce,
      `a script the page loads is not signed with the policy's nonce: ${src}`
    );
  }

  // And the other half of "only": the nonce is the page's, and the document
  // never gets it. A document's script carrying it would be a document's script
  // the policy admits, which is the whole security story unravelling.
  for (const tag of byTag(root, 'script').filter((el) => inDocument.has(el))) {
    assert.notStrictEqual(
      attrOf(tag, 'nonce'),
      nonce,
      `a script written in the document carries the page's own nonce: ${attrOf(tag, 'src') ?? '(inline)'}`
    );
  }
});

Then<PreviewWorld>('the page refuses every kind of content it has not named', function () {
  const defaultSrc = directive(policyIn(this.buildPage()), 'default-src');
  assert.strictEqual(
    defaultSrc,
    "'none'",
    "default-src is the directive that refuses an <iframe> (through frame-src), a connection, " +
      `a stylesheet or a font the directives below do not name, so 'none' is what makes the ` +
      `rest of the policy a boundary rather than a list; got ${defaultSrc}`
  );
});

Then<PreviewWorld>('the page refuses to post a form anywhere', function () {
  const formAction = directive(policyIn(this.buildPage()), 'form-action');
  assert.strictEqual(
    formAction,
    "'none'",
    "form-action does not fall back to default-src, so 'none' on default-src alone leaves a " +
      `<form> in a document free to post wherever its action points; got ${formAction}`
  );
});

// The two halves of the old "loads media from nowhere but itself", which could
// only ever be true with remote images off and so asserted the off state
// alongside the property. Split, because agreeing with img-src is the property
// and holding the network back is the setting — and the setting now has an on
// branch with a scenario of its own.
//
// Compared against img-src rather than against a list written here, because
// agreeing with img-src is the actual property: media is a source out of the
// document exactly as a picture is, so it crosses the same boundary and answers
// to the same setting. A copy of the expected sources would be a second place
// to keep in step, and would pass while the two directives drifted apart.
Then<PreviewWorld>('the page treats media exactly as it treats images', function () {
  const policy = policyIn(this.buildPage());
  const sources = sourcesOf(policy, 'media-src');
  const imageSources = sourcesOf(policy, 'img-src');
  assert.deepStrictEqual(
    sources,
    imageSources,
    `media-src admits ${JSON.stringify(sources)} while img-src admits ` +
      `${JSON.stringify(imageSources)} — the setting that holds one back has to hold both back`
  );
});

// Whole sources, not a substring: the stand-in origin is itself an `https:`
// URL, so `mediaSrc.includes('https:')` is true whichever way this goes.
Then<PreviewWorld>('the page admits nothing from the network', function () {
  const policy = policyIn(this.buildPage());
  for (const name of ['img-src', 'media-src']) {
    const sources = sourcesOf(policy, name);
    assert.ok(
      !sources.includes('https:'),
      `${name} admits the whole network: ${name} ${sources.join(' ')}`
    );
  }
});

// The other direction, and the reason the two above are not simply "the page is
// strict": with the setting on, the network is admitted on purpose, and a
// directive that stayed closed would be a setting that does nothing.
Then<PreviewWorld>('the page admits images from the network', function () {
  const sources = sourcesOf(policyIn(this.buildPage()), 'img-src');
  assert.ok(
    sources.includes('https:'),
    `remote images are on, but img-src admits no network: img-src ${sources.join(' ')}`
  );
});

/** The nonce the page's policy is signed with. */
function nonceOf(page: string): string | null {
  return /(?:^|;\s*)script-src[^;]*'nonce-([A-Za-z0-9]+)'/.exec(policyIn(page))?.[1] ?? null;
}

// The one step that wants two builds rather than one. `buildPage()` hands back
// a fresh page every time, which is the same thing the host does, and it is
// what makes this assertable at all.
Then<PreviewWorld>('two builds of the page are signed with different nonces', function () {
  const first = nonceOf(this.buildPage());
  const second = nonceOf(this.buildPage());
  assert.ok(first, 'the page carries a policy with no nonce in it');
  assert.ok(
    first.length >= 16,
    `a ${first.length}-character nonce is short enough to guess, which defeats the point of one`
  );
  assert.notStrictEqual(
    first,
    second,
    'the same nonce came out of two builds, so it is a constant rather than a nonce'
  );
});
