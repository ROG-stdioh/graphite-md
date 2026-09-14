// Steps for what a document's content turns into: inline syntax, task lists,
// math, diagrams, code blocks, links, and the two things the preview refuses
// to do with raw HTML.
const assert = require('assert');
const { Then } = require('@cucumber/cucumber');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Does `text` appear wrapped in exactly this tag?
function inTag(html, tag, text) {
  return new RegExp('<' + tag + '(?:\\s[^>]*)?>' + escapeRe(text) + '</' + tag + '>').test(html);
}

// Every link the preview produced, as { href, text }.
function anchors(html) {
  return [...html.matchAll(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: m[1],
    text: m[2].replace(/<[^>]*>/g, '').trim(),
  }));
}

// ---- inline syntax -------------------------------------------------------

Then('the preview shows {string} as superscript', function (text) {
  assert.ok(inTag(this.html, 'sup', text), `expected "${text}" in a <sup>`);
});

Then('the preview shows {string} as subscript', function (text) {
  assert.ok(inTag(this.html, 'sub', text), `expected "${text}" in a <sub>`);
});

Then('the preview underlines {string}', function (text) {
  assert.ok(inTag(this.html, 'ins', text), `expected "${text}" underlined`);
});

Then('the preview highlights {string}', function (text) {
  assert.ok(inTag(this.html, 'mark', text), `expected "${text}" highlighted`);
});

Then('the preview strikes through {string}', function (text) {
  assert.ok(inTag(this.html, 's', text), `expected "${text}" struck through`);
});

// ---- footnotes -----------------------------------------------------------

Then('the note is rendered at the foot of the page', function () {
  assert.ok(/<section class="footnotes">/.test(this.html), 'expected a footnotes section');
  assert.ok(/class="footnote-ref"/.test(this.html), 'expected a reference in the body');
});

Then('the note links back to the sentence that cited it', function () {
  const m = this.html.match(/<a href="#(fnref\d+)" class="footnote-backref">/);
  assert.ok(m, 'expected a back-reference from the note to its citation');
  assert.ok(
    this.html.includes('id="' + m[1] + '"'),
    `the note points back at "${m[1]}", which is not in the document`
  );
});

// ---- task lists ----------------------------------------------------------

function taskItems(html) {
  return [...html.matchAll(/<span class="task-checkbox( checked)?"(?: data-line="(\d+)")?><\/span>/g)].map(
    (m) => ({ checked: Boolean(m[1]), line: m[2] === undefined ? null : Number(m[2]) })
  );
}

Then('the preview shows {int} task items', function (expected) {
  const found = taskItems(this.html).length;
  assert.strictEqual(found, expected, `expected ${expected} task items, found ${found}`);
});

Then('{int} of them are ticked', function (expected) {
  const found = taskItems(this.html).filter((t) => t.checked).length;
  assert.strictEqual(found, expected, `expected ${expected} ticked, found ${found}`);
});

// Clicking a checkbox rewrites that line of the file, so a checkbox with no
// source line is one that cannot be clicked.
Then('every task item knows which line of the file it came from', function () {
  for (const item of taskItems(this.html)) {
    assert.notStrictEqual(item.line, null, 'a task item has no source line to write back to');
  }
});

// ---- math ----------------------------------------------------------------

Then('the preview renders it as math', function () {
  assert.ok(/class="katex"/.test(this.html), 'expected KaTeX output');
});

Then('the preview renders it as displayed math', function () {
  assert.ok(/class="katex-display"/.test(this.html), 'expected display-mode KaTeX output');
});

Then('the bad math is marked rather than breaking the page', function () {
  assert.ok(/katex-error/.test(this.html), 'expected the malformed maths to be flagged');
});

Then('the render still produced a page', function () {
  assert.ok(this.html.length > 0, 'the renderer returned nothing');
});

// ---- diagrams ------------------------------------------------------------

Then('the preview renders a diagram', function () {
  assert.ok(/class="mermaid"/.test(this.html), 'expected a mermaid container');
});

Then('the diagram is handed its source to draw', function () {
  const m = this.html.match(/<div class="mermaid"[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(m, 'expected a mermaid container');
  assert.ok(m[1].trim().length > 0, 'the mermaid container was handed nothing to draw');
});

// ---- code blocks ---------------------------------------------------------

Then('the code is syntax highlighted', function () {
  assert.ok(/<pre class="hljs">/.test(this.html), 'expected a highlighted code block');
  assert.ok(/class="hljs-/.test(this.html), 'expected highlight.js spans inside it');
});

Then('the code is shown without highlighting', function () {
  assert.ok(!/hljs/.test(this.html), 'expected no highlighting, but highlight.js output was present');
});

// Entities are decoded first so the scenario can quote what a reader sees
// ("<angle brackets>") rather than what the HTML says (&lt;angle brackets&gt;).
Then('the code shows the literal text {string}', function (expected) {
  const shown = this.html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
  assert.ok(shown.includes(expected), `expected the code block to show "${expected}"`);
});

// ---- links ---------------------------------------------------------------

Then('{string} is not turned into a link', function (text) {
  const hit = anchors(this.html).find((a) => a.text === text);
  assert.ok(!hit, `expected "${text}" to stay plain text, but it linked to ${hit && hit.href}`);
});

Then('{string} is a link to {string}', function (text, href) {
  const hit = anchors(this.html).find((a) => a.text === text);
  assert.ok(hit, `expected "${text}" to become a link`);
  assert.strictEqual(hit.href, href, `"${text}" linked to ${hit.href}, expected ${href}`);
});

Then('{string} is an email link', function (text) {
  const hit = anchors(this.html).find((a) => a.text === text);
  assert.ok(hit, `expected "${text}" to become a link`);
  assert.ok(hit.href.startsWith('mailto:'), `expected a mailto: link, got ${hit.href}`);
});

// ---- safety --------------------------------------------------------------

Then('the script tag is shown as text, not run', function () {
  assert.ok(this.html.includes('&lt;script&gt;'), 'expected the tag to be escaped and visible');
  assert.ok(!/<script[\s>]/.test(this.html), 'a live <script> element reached the page');
});

Then('the comment disappears from the preview', function () {
  assert.ok(!this.html.includes('hidden'), 'the HTML comment leaked into the rendered page');
});
