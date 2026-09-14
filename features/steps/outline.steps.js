// Steps for the outline pane — its Content, Tables and Diagrams views.
const assert = require('assert');
const { Then } = require('@cucumber/cucumber');
const { flatten } = require('../support/world.js');

// The whole shape of the Content view in one table, with nesting as a depth
// number. Asserting the full tree rather than poking at individual nodes is
// what catches a heading that quietly lands at the wrong level.
Then('the outline reads:', function (dataTable) {
  const expected = dataTable.hashes().map((row) => ({
    depth: Number(row.depth),
    label: row.section,
  }));
  const actual = flatten(this.content).map((n) => ({ depth: n.depth, label: n.label }));
  assert.deepStrictEqual(
    actual,
    expected,
    '\n  outline mismatch\n  expected: ' + JSON.stringify(expected) +
      '\n  actual:   ' + JSON.stringify(actual)
  );
});

Then('the outline is empty', function () {
  assert.strictEqual(this.content.length, 0, 'expected no outline entries');
});

Then('the outline contains a section named {string}', function (label) {
  assert.ok(
    flatten(this.content).some((n) => n.label === label),
    `expected an outline section named "${label}", got: ` +
      JSON.stringify(flatten(this.content).map((n) => n.label))
  );
});

Then('the outline does not contain a section named {string}', function (label) {
  assert.ok(
    !flatten(this.content).some((n) => n.label === label),
    `expected no outline section named "${label}", but one was there`
  );
});

// Clicking an outline node scrolls to the element carrying this id, so a node
// whose target does not exist in the document is a dead entry in the pane.
Then('every outline entry points at something in the document', function () {
  for (const node of flatten(this.content)) {
    assert.ok(
      this.html.includes('id="' + node.target + '"'),
      `outline entry "${node.label}" targets "${node.target}", which is not in the document`
    );
  }
});

Then('the outline lists {int} tables', function (expected) {
  assert.strictEqual(this.tables.length, expected, `expected ${expected} tables in the outline`);
});

Then('the outline lists a table named {string}', function (label) {
  assert.ok(
    this.tables.some((t) => t.label === label),
    `expected a table labelled "${label}", got: ` + JSON.stringify(this.tables.map((t) => t.label))
  );
});

Then('the outline lists {int} diagrams', function (expected) {
  assert.strictEqual(this.diagrams.length, expected, `expected ${expected} diagrams in the outline`);
});

Then('the outline lists a diagram named {string}', function (label) {
  assert.ok(
    this.diagrams.some((d) => d.label === label),
    `expected a diagram labelled "${label}", got: ` +
      JSON.stringify(this.diagrams.map((d) => d.label))
  );
});

Then('every outline table points at a table in the document', function () {
  for (const t of this.tables) {
    assert.ok(this.html.includes('id="' + t.target + '"'), `table entry "${t.label}" is a dead link`);
  }
});
