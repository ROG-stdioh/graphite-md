// Steps for building a document, rendering it, and reading the result.
const assert = require('assert');
const { Given, When, Then } = require('@cucumber/cucumber');

Given('a markdown document:', function (docString) {
  this.source = docString;
});

// The single-line form, for scenarios where a docstring would be noise.
// Cucumber unescapes \n in {string}, so a short multi-line doc still reads
// inline when that is clearer.
Given('a markdown document {string}', function (source) {
  this.source = source;
});

When('the preview renders it', function () {
  this.render();
});

Then('the document title is {string}', function (expected) {
  const m = this.html.match(/<h1 class="doc-title">([\s\S]*?)<\/h1>/);
  assert.ok(m, 'the preview rendered no document title');
  assert.strictEqual(m[1].trim(), expected);
});

Then('the preview has no document title', function () {
  assert.ok(
    !/<h1 class="doc-title">/.test(this.html),
    'expected no document title, but one was rendered'
  );
});

// A section is what the preview makes collapsible — one per heading below the
// title, at whatever level.
Then('the preview shows {int} collapsible sections', function (expected) {
  const found = (this.html.match(/class="section-head"/g) || []).length;
  assert.strictEqual(found, expected, `expected ${expected} collapsible sections, found ${found}`);
});

Then('the preview shows {string} as a heading', function (text) {
  const re = new RegExp('<h[1-6][^>]*>[\\s\\S]*?' + escapeRe(text) + '[\\s\\S]*?</h[1-6]>');
  assert.ok(re.test(this.html), `expected "${text}" to render as a heading`);
});

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
