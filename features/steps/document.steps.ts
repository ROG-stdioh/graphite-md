// Steps for building a document, rendering it, and reading the result.
//
// Each step names its world as a type argument, which is what types `this` —
// Cucumber's step functions default to `IWorld`, whose index signature makes
// every property access `any`. The parameter annotations are the other half:
// Cucumber's own signature is `(...args: any[])`, so an unannotated parameter
// arrives as `any` and every use of it would be unchecked.
import type { DataTable } from '@cucumber/cucumber';
import type { PreviewWorld } from '../support/world';

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
// Cucumber unescapes \n in {string}, so a short multi-line doc still reads
// inline when that is clearer.
Given<PreviewWorld>('a markdown document {string}', function (source: string) {
  this.source = source;
});

When<PreviewWorld>('the preview renders it', function () {
  this.render();
});

Then<PreviewWorld>('the document title is {string}', function (expected: string) {
  const m = this.html.match(/<h1 class="doc-title">([\s\S]*?)<\/h1>/);
  assert.ok(m, 'the preview rendered no document title');
  // `?.` rather than `m[1]`: the capture group is not optional, so this is only
  // ever reached with a string, but the compiler cannot know that and a
  // non-null assertion here would be a claim rather than a check.
  assert.strictEqual(m[1]?.trim(), expected);
});

Then<PreviewWorld>('the preview has no document title', function () {
  assert.ok(
    !/<h1 class="doc-title">/.test(this.html),
    'expected no document title, but one was rendered'
  );
});

// A section is what the preview makes collapsible — one per heading below the
// title, at whatever level.
Then<PreviewWorld>('the preview shows {int} collapsible sections', function (expected: number) {
  const found = (this.html.match(/class="section-head"/g) ?? []).length;
  assert.strictEqual(found, expected, `expected ${expected} collapsible sections, found ${found}`);
});

Then<PreviewWorld>('the preview shows {string} as a heading', function (text: string) {
  const re = new RegExp('<h[1-6][^>]*>[\\s\\S]*?' + escapeRe(text) + '[\\s\\S]*?</h[1-6]>');
  assert.ok(re.test(this.html), `expected "${text}" to render as a heading`);
});

// A heading's anchor is the slug of its own text, so `## Tables` is reachable
// at `#tables`. The whole list is asserted in document order, because the
// failure worth catching is not one missing anchor but anchors drifting apart
// from the headings they belong to.
Then<PreviewWorld>('the headings are anchored at:', function (dataTable: DataTable) {
  const expected = dataTable.hashes().map((row) => row.anchor ?? '');
  const actual = [...this.html.matchAll(/<h[1-6] class="section-head" id="([^"]*)"/g)].map(
    (m) => m[1] ?? ''
  );
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
  // `data-id="…"` is not an id attribute, and \b matches between its hyphen and
  // the following `i` — hence the lookbehind rather than a word boundary.
  for (const [, id = ''] of this.html.matchAll(/(?<!data-)\bid="([^"]*)"/g)) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const shared = [...counts].filter(([, n]) => n > 1).map(([id]) => id);
  assert.deepStrictEqual(
    shared,
    [],
    `these ids are on more than one element: ${JSON.stringify(shared)}`
  );
});

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
