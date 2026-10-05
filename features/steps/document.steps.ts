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

const { allElements, attrOf, byClass, classesOf, parseHtml, textOf }: typeof Html =
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
