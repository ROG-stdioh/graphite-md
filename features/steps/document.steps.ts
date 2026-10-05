// Steps for building a document, rendering it, and reading the result.
//
// Each step names its world as a type argument, which is what types `this` —
// Cucumber's step functions default to `IWorld`, whose index signature makes
// every property access `any`. The parameter annotations are the other half:
// Cucumber's own signature is `(...args: any[])`, so an unannotated parameter
// arrives as `any` and every use of it would be unchecked.
//
// What the preview produced is read through the parser in ../lib/html, not
// matched as a string. The patterns this file used to carry were anchored on
// attribute order and on tags being written the way the renderer writes them,
// and the id check in particular found `id="…"` written inside a code fence —
// a duplicate that exists only in the document's text.
import type { DataTable } from '@cucumber/cucumber';
import type * as Html from '../lib/html';
import type { PreviewWorld } from '../support/world';

const { allElements, attrOf, byClass, byTag, classesOf, parseHtml, textOf }: typeof Html =
  require('../lib/html.ts') as typeof Html;

// The annotation and the cast are both load-bearing; neither is redundant.
// `assert.ok` and friends are *assertion functions* — calling one narrows the
// value it was given, which is what the steps rely on when they match on a
// regex and then use the capture. TypeScript only honours that narrowing when
// the binding the call goes through is *declared* with an explicit type
// annotation. A cast on the initializer is not a declaration, so the shorter
// `const assert = require('assert') as typeof import('assert')` compiles but
// narrowing never happens: every call site reports TS2775 ("Assertions require
// every name in the call target to be declared with an explicit type
// annotation") and the value stays nullable afterwards. The cast types the
// value; the annotation licenses the narrowing.
const assert: typeof import('assert') = require('assert') as typeof import('assert');
const { Given, When, Then } = require('@cucumber/cucumber') as typeof import('@cucumber/cucumber');

Given<PreviewWorld>('a markdown document:', function (docString: string) {
  this.source = docString;
});

// The single-line form, for scenarios where a docstring would be noise.
//
// It is single-line in fact and not just in style: Cucumber does not unescape
// \n inside {string}, so a "\n" written here arrives as a literal backslash and
// the letter n. This comment claimed the opposite until a scenario about line
// breaks was written against it and failed; nothing in the suite had relied on
// it either way, which is exactly why it survived. A document with a real line
// break needs the docstring form above.
Given<PreviewWorld>('a markdown document {string}', function (source: string) {
  this.source = source;
});

When<PreviewWorld>('the preview renders it', function () {
  this.render();
});

/** The text of the first element carrying this class, or null when there is none. */
function textOfClass(html: string, className: string): string | null {
  const [first] = byClass(parseHtml(html), className);
  return first ? textOf(first).trim() : null;
}

// The page's text as a reader would select it: every element's own text, entities
// decoded, markup gone. For a scenario that quotes a sentence rather than naming
// the element the sentence is wrapped in — which is the only way to ask whether
// something is on the page at all without also pinning how the renderer chose to
// wrap it.
Then<PreviewWorld>('the preview shows the text {string}', function (expected: string) {
  const text = textOf(parseHtml(this.html));
  assert.ok(
    text.includes(expected),
    `expected the page to contain ${JSON.stringify(expected)}; its text reads ` + JSON.stringify(text)
  );
});

// The negative, and it is never evidence on its own: a page that rendered
// nothing at all satisfies it. Every scenario that uses this pairs it with
// something that did render, so "absent" cannot be reached by "empty" — the
// front-matter block is the case that needs it, since it is about a block that
// has to disappear without taking the document with it.
Then<PreviewWorld>('the preview does not show {string}', function (unwanted: string) {
  const text = textOf(parseHtml(this.html));
  assert.ok(
    !text.includes(unwanted),
    `expected the page not to contain ${JSON.stringify(unwanted)}; its text reads ` + JSON.stringify(text)
  );
});

Then<PreviewWorld>('the document title is {string}', function (expected: string) {
  const title = textOfClass(this.html, 'doc-title');
  assert.ok(title !== null, 'the preview rendered no document title');
  assert.strictEqual(title, expected, `the document title reads ${JSON.stringify(title)}`);
});

Then<PreviewWorld>('the preview has no document title', function () {
  assert.deepStrictEqual(
    byClass(parseHtml(this.html), 'doc-title'),
    [],
    'expected no document title, but one was rendered'
  );
});

// The opening paragraph of a document that names itself reads as a subtitle.
// "Exactly one" rather than "one of them", so a renderer that marked every
// paragraph is a failure and not a longer list of successes.
Then<PreviewWorld>('the preview shows {string} as the subtitle', function (expected: string) {
  const subtitles = byClass(parseHtml(this.html), 'doc-sub');
  assert.strictEqual(
    subtitles.length,
    1,
    `expected exactly one subtitle, found ${subtitles.length}`
  );
  const [subtitle] = subtitles;
  assert.ok(subtitle, 'expected a subtitle element');
  const reads = textOf(subtitle).trim();
  assert.strictEqual(reads, expected, `the subtitle reads ${JSON.stringify(reads)}`);
});

// Never evidence on its own: a renderer that dropped the paragraph satisfies
// it. Every scenario using this asserts what did render beside it, so "not a
// subtitle" cannot be reached by "not a paragraph".
Then<PreviewWorld>('the preview shows no subtitle', function () {
  assert.deepStrictEqual(
    byClass(parseHtml(this.html), 'doc-sub'),
    [],
    'expected no subtitle, but the opening paragraph was rendered as one'
  );
});

// A section is what the preview makes collapsible — one per heading below the
// title, at whatever level.
Then<PreviewWorld>('the preview shows {int} collapsible sections', function (expected: number) {
  const found = byClass(parseHtml(this.html), 'section-head').length;
  assert.strictEqual(found, expected, `expected ${expected} collapsible sections, found ${found}`);
});

// Any heading, at any level, anywhere in the document. Which is the point: the
// scenarios that assert a heading contributes no *section* need this to show
// the heading itself did render, or "nothing became a section" would be
// satisfied by nothing being a heading either.
Then<PreviewWorld>('the preview shows {string} as a heading', function (text: string) {
  const headings = allElements(parseHtml(this.html)).filter((el) => /^h[1-6]$/.test(el.tagName));
  assert.ok(
    headings.some((el) => textOf(el).includes(text)),
    `expected "${text}" to render as a heading; the page's headings hold ` +
      JSON.stringify(headings.map((el) => textOf(el)))
  );
});

// A heading's anchor is the slug of its own text, so `## Tables` is reachable
// at `#tables`. The whole list is asserted in document order, because the
// failure worth catching is not one missing anchor but anchors drifting apart
// from the headings they belong to.
//
// Selected by class rather than by the shape of the tag, so the check reads the
// same whatever order the renderer writes its attributes in — the pattern this
// replaced required `class` before `id` and would have reported an empty list,
// not a mismatch, the day that changed.
Then<PreviewWorld>('the headings are anchored at:', function (dataTable: DataTable) {
  const expected = dataTable.hashes().map((row) => row.anchor ?? '');
  const actual = allElements(parseHtml(this.html))
    .filter((el) => /^h[1-6]$/.test(el.tagName) && classesOf(el).includes('section-head'))
    .map((el) => attrOf(el, 'id') ?? '');
  assert.deepStrictEqual(
    actual,
    expected,
    '\n  anchors mismatch\n  expected: ' +
      JSON.stringify(expected) +
      '\n  actual:   ' +
      JSON.stringify(actual)
  );
});

// Two elements under one id renders perfectly well and is therefore invisible:
// the browser keeps both, getElementById returns whichever came first, and the
// second one simply cannot be reached — so every outline target and anchor
// click that names that id goes somewhere else, with nothing in the log to say
// so. This is the property the renderer's id allocation exists to hold.
Then<PreviewWorld>('no two elements share an id', function () {
  const counts = new Map<string, number>();
  // Read off the parse, so only an element's own id counts. The pattern this
  // replaced read the raw HTML, where an `id="…"` written inside an HTML
  // comment — and comments reach the page as real comments — counted as a
  // second element carrying it: a duplicate reported against a document that is
  // perfectly well formed.
  for (const el of allElements(parseHtml(this.html))) {
    const id = attrOf(el, 'id');
    if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const shared = [...counts].filter(([, n]) => n > 1).map(([id]) => id);
  assert.deepStrictEqual(
    shared,
    [],
    `these ids are on more than one element: ${JSON.stringify(shared)}`
  );
});

// ---- front matter ---------------------------------------------------------
// The table src/markdown.ts draws for the YAML above the first heading.
//
// Every assertion here is on the parsed tree rather than on the text, and that
// is the whole point of them: the faults these scenarios guard against are
// shapes. The keys arriving as a heading, the block arriving as prose, a value's
// markup arriving as markup — all three put the same words on the page, and a
// substring search is satisfied by any of them.
//
// So each scenario that reads a row also asserts what rendered below the block.
// A table drawn correctly above a document that lost its title is not a pass.

/** The one front matter table, or a failure naming how many were found. */
function frontMatterTable(html: string): Html.El {
  const tables = byClass(parseHtml(html), 'frontmatter');
  assert.strictEqual(tables.length, 1, `expected one front matter table in the preview, found ${tables.length}`);
  const table = tables[0];
  if (table === undefined) throw new Error('unreachable: the count above leaves exactly one table');
  return table;
}

/** A row's key cell, which is what a scenario naming a key is asking for. */
function rowKey(row: Html.El): string {
  const key = byTag(row, 'th')[0];
  return key === undefined ? '' : textOf(key);
}

/**
 * The row whose key reads `key`, or a failure listing the keys that are there:
 * a scenario asking for `title` against a table that says `Title` should say so
 * rather than report a missing value.
 */
function frontMatterRow(html: string, key: string): Html.El {
  const rows = byTag(frontMatterTable(html), 'tr');
  const row = rows.find((r) => rowKey(r) === key);
  assert.ok(
    row !== undefined,
    `no front matter row for "${key}"; the table's keys are ${JSON.stringify(rows.map(rowKey))}`
  );
  return row;
}

/** A row's value cell, which is the second half of it. */
function rowValue(html: string, key: string): Html.El {
  const cell = byTag(frontMatterRow(html, key), 'td')[0];
  assert.ok(cell !== undefined, `the front matter row for "${key}" has no value cell`);
  return cell;
}

Then<PreviewWorld>('the preview draws the front matter as a table', function () {
  frontMatterTable(this.html);
});

Then<PreviewWorld>('the front matter table has {int} rows', function (expected: number) {
  const rows = byTag(frontMatterTable(this.html), 'tr');
  assert.strictEqual(rows.length, expected, `expected ${expected} front matter row(s), found ${rows.length}`);
});

Then<PreviewWorld>('the front matter row {string} holds {string}', function (key: string, value: string) {
  const held = textOf(rowValue(this.html, key));
  assert.strictEqual(held, value, `the front matter row for "${key}" holds ${JSON.stringify(held)}`);
});

// A list is the one value that is not its own text: `sample, conformance` and
// two `<li>` elements are different answers, and it is the second one the
// document meant.
Then<PreviewWorld>('the front matter row {string} holds a list of {int} items', function (key: string, expected: number) {
  const cell = rowValue(this.html, key);
  const items = byTag(cell, 'li');
  assert.strictEqual(
    byTag(cell, 'ul').length,
    1,
    `the front matter row for "${key}" is not a list: it holds ${JSON.stringify(textOf(cell))}`
  );
  assert.strictEqual(items.length, expected, `expected ${expected} item(s) in "${key}", found ${items.length}`);
});

// A nested map has no cell of its own to be flattened into, so it is shown as
// the YAML it is.
Then<PreviewWorld>('the front matter row {string} holds the YAML {string}', function (key: string, yaml: string) {
  const code = byTag(rowValue(this.html, key), 'code')[0];
  assert.ok(code !== undefined, `the front matter row for "${key}" holds no code element`);
  assert.strictEqual(textOf(code).trimEnd(), yaml);
});

Then<PreviewWorld>('the preview reports a front matter error', function () {
  const errors = byClass(parseHtml(this.html), 'frontmatter-error');
  assert.strictEqual(errors.length, 1, `expected one front matter error, found ${errors.length}`);
  const first = errors[0];
  if (first === undefined) throw new Error('unreachable: the count above leaves exactly one');
  assert.strictEqual(attrOf(first, 'role'), 'alert', 'the front matter error is not announced');
});
