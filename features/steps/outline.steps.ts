// Steps for the outline pane — its Content, Tables and Diagrams views.
//
// See document.steps.ts for why every step takes a world type argument and
// every parameter an annotation.
import type { DataTable } from '@cucumber/cucumber';
// TocNode comes from the shared contract rather than src/markdown.ts — see
// world.ts.
import type { TocNode } from '../../src/shared/protocol';
import type { FlatNode, PreviewWorld } from '../support/world';

// Annotated as well as cast — see document.steps.ts for why both are needed.
const assert: typeof import('assert') = require('assert') as typeof import('assert');
const { Then } = require('@cucumber/cucumber') as typeof import('@cucumber/cucumber');

// world.ts sets its exports with `module.exports`, which the compiler cannot
// read a module's shape from — so the one value this file needs is named
// explicitly, with the element types still coming from world.ts itself.
const { flatten } = require('../support/world.ts') as {
  flatten: (nodes: readonly TocNode[]) => FlatNode[];
};

// The whole shape of the Content view in one table, with nesting as a depth
// number. Asserting the full tree rather than poking at individual nodes is
// what catches a heading that quietly lands at the wrong level.
Then<PreviewWorld>('the outline reads:', function (dataTable: DataTable) {
  const expected = dataTable.hashes().map((row) => ({
    depth: Number(row.depth),
    label: row.section ?? '',
  }));
  const actual = flatten(this.content).map((n) => ({ depth: n.depth, label: n.label }));
  assert.deepStrictEqual(
    actual,
    expected,
    '\n  outline mismatch\n  expected: ' + JSON.stringify(expected) +
      '\n  actual:   ' + JSON.stringify(actual)
  );
});

Then<PreviewWorld>('the outline is empty', function () {
  assert.strictEqual(this.content.length, 0, 'expected no outline entries');
});

Then<PreviewWorld>('the outline contains a section named {string}', function (label: string) {
  assert.ok(
    flatten(this.content).some((n) => n.label === label),
    `expected an outline section named "${label}", got: ` +
      JSON.stringify(flatten(this.content).map((n) => n.label))
  );
});

Then<PreviewWorld>('the outline does not contain a section named {string}', function (label: string) {
  assert.ok(
    !flatten(this.content).some((n) => n.label === label),
    `expected no outline section named "${label}", but one was there`
  );
});

// Clicking an outline node scrolls to the element carrying this id, so a node
// whose target does not exist in the document is a dead entry in the pane.
Then<PreviewWorld>('every outline entry points at something in the document', function () {
  for (const node of flatten(this.content)) {
    assert.ok(
      this.html.includes('id="' + node.target + '"'),
      `outline entry "${node.label}" targets "${node.target}", which is not in the document`
    );
  }
});

// The Tables view as a whole, in order, the way `the outline reads:` does for
// Content. Existence is not enough to assert here: the pane is a list of where
// things are in the document, and two entries the wrong way round send a reader
// who trusts it to the wrong part of the page.
Then<PreviewWorld>('the tables read:', function (dataTable: DataTable) {
  const expected = dataTable.hashes().map((row) => ({
    label: row.table ?? '',
    target: row.target ?? '',
  }));
  const actual = this.tables.map((t) => ({ label: t.label, target: t.target }));
  assert.deepStrictEqual(
    actual,
    expected,
    '\n  table list mismatch\n  expected: ' + JSON.stringify(expected) +
      '\n  actual:   ' + JSON.stringify(actual)
  );
});

Then<PreviewWorld>('the outline lists {int} tables', function (expected: number) {
  assert.strictEqual(this.tables.length, expected, `expected ${expected} tables in the outline`);
});

Then<PreviewWorld>('the outline lists a table named {string}', function (label: string) {
  assert.ok(
    this.tables.some((t) => t.label === label),
    `expected a table labelled "${label}", got: ` + JSON.stringify(this.tables.map((t) => t.label))
  );
});

// Clicking an entry scrolls to the element carrying this id, so a table whose
// id was taken by something else is an entry that scrolls to the wrong place.
Then<PreviewWorld>('the outline lists a table at {string}', function (target: string) {
  assert.ok(
    this.tables.some((t) => t.target === target),
    `expected a table targeting "${target}", got: ` +
      JSON.stringify(this.tables.map((t) => t.target))
  );
});

Then<PreviewWorld>('the outline lists {int} diagrams', function (expected: number) {
  assert.strictEqual(this.diagrams.length, expected, `expected ${expected} diagrams in the outline`);
});

Then<PreviewWorld>('the outline lists a diagram named {string}', function (label: string) {
  assert.ok(
    this.diagrams.some((d) => d.label === label),
    `expected a diagram labelled "${label}", got: ` +
      JSON.stringify(this.diagrams.map((d) => d.label))
  );
});

Then<PreviewWorld>('every outline table points at a table in the document', function () {
  for (const t of this.tables) {
    assert.ok(this.html.includes('id="' + t.target + '"'), `table entry "${t.label}" is a dead link`);
  }
});
