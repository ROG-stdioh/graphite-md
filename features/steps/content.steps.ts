// Steps for what a document's content turns into: inline syntax, task lists,
// math, diagrams, code blocks, links, and the two things the preview refuses
// to do with raw HTML.
//
// See document.steps.ts for why every step takes a world type argument and
// every parameter an annotation.
import type { PreviewWorld } from '../support/world';

// Annotated as well as cast — see document.steps.ts for why both are needed.
const assert: typeof import('assert') = require('assert') as typeof import('assert');
const { Then } = require('@cucumber/cucumber') as typeof import('@cucumber/cucumber');

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Does `text` appear wrapped in exactly this tag?
function inTag(html: string, tag: string, text: string): boolean {
  return new RegExp('<' + tag + '(?:\\s[^>]*)?>' + escapeRe(text) + '</' + tag + '>').test(html);
}

// Every link the preview produced, as { href, text }.
function anchors(html: string): { href: string; text: string }[] {
  return [...html.matchAll(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(
    ([, href = '', body = '']) => ({
      href,
      text: body.replace(/<[^>]*>/g, '').trim(),
    })
  );
}

// ---- inline syntax -------------------------------------------------------

Then<PreviewWorld>('the preview shows {string} as superscript', function (text: string) {
  assert.ok(inTag(this.html, 'sup', text), `expected "${text}" in a <sup>`);
});

Then<PreviewWorld>('the preview shows {string} as subscript', function (text: string) {
  assert.ok(inTag(this.html, 'sub', text), `expected "${text}" in a <sub>`);
});

Then<PreviewWorld>('the preview underlines {string}', function (text: string) {
  assert.ok(inTag(this.html, 'ins', text), `expected "${text}" underlined`);
});

Then<PreviewWorld>('the preview highlights {string}', function (text: string) {
  assert.ok(inTag(this.html, 'mark', text), `expected "${text}" highlighted`);
});

Then<PreviewWorld>('the preview strikes through {string}', function (text: string) {
  assert.ok(inTag(this.html, 's', text), `expected "${text}" struck through`);
});

// ---- footnotes -----------------------------------------------------------

Then<PreviewWorld>('the note is rendered at the foot of the page', function () {
  assert.ok(/<section class="footnotes">/.test(this.html), 'expected a footnotes section');
  assert.ok(/class="footnote-ref"/.test(this.html), 'expected a reference in the body');
});

Then<PreviewWorld>('the note links back to the sentence that cited it', function () {
  const m = this.html.match(/<a href="#(fnref\d+)" class="footnote-backref">/);
  assert.ok(m, 'expected a back-reference from the note to its citation');
  const id = m[1];
  assert.ok(id !== undefined, 'the back-reference has no id to point at');
  assert.ok(
    this.html.includes('id="' + id + '"'),
    `the note points back at "${id}", which is not in the document`
  );
});

// ---- task lists ----------------------------------------------------------

function taskItems(html: string): { checked: boolean; line: number | null }[] {
  return [...html.matchAll(/<span class="task-checkbox( checked)?"(?: data-line="(\d+)")?><\/span>/g)].map(
    ([, checked, line]) => ({
      checked: Boolean(checked),
      line: line === undefined ? null : Number(line),
    })
  );
}

Then<PreviewWorld>('the preview shows {int} task items', function (expected: number) {
  const found = taskItems(this.html).length;
  assert.strictEqual(found, expected, `expected ${expected} task items, found ${found}`);
});

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

// ---- math ----------------------------------------------------------------

Then<PreviewWorld>('the preview renders it as math', function () {
  assert.ok(/class="katex"/.test(this.html), 'expected KaTeX output');
});

Then<PreviewWorld>('the preview renders it as displayed math', function () {
  assert.ok(/class="katex-display"/.test(this.html), 'expected display-mode KaTeX output');
});

Then<PreviewWorld>('the bad math is marked rather than breaking the page', function () {
  assert.ok(/katex-error/.test(this.html), 'expected the malformed maths to be flagged');
});

Then<PreviewWorld>('the render still produced a page', function () {
  assert.ok(this.html.length > 0, 'the renderer returned nothing');
});

// ---- diagrams ------------------------------------------------------------

Then<PreviewWorld>('the preview renders a diagram', function () {
  assert.ok(/class="mermaid"/.test(this.html), 'expected a mermaid container');
});

Then<PreviewWorld>('the diagram is handed its source to draw', function () {
  const m = this.html.match(/<div class="mermaid"[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(m, 'expected a mermaid container');
  const source = (m[1] ?? '').trim();
  assert.ok(source.length > 0, 'the mermaid container was handed nothing to draw');
});

// ---- code blocks ---------------------------------------------------------

Then<PreviewWorld>('the code is syntax highlighted', function () {
  assert.ok(/<pre class="hljs">/.test(this.html), 'expected a highlighted code block');
  assert.ok(/class="hljs-/.test(this.html), 'expected highlight.js spans inside it');
});

Then<PreviewWorld>('the code is shown without highlighting', function () {
  assert.ok(!/hljs/.test(this.html), 'expected no highlighting, but highlight.js output was present');
});

// Entities are decoded first so the scenario can quote what a reader sees
// ("<angle brackets>") rather than what the HTML says (&lt;angle brackets&gt;).
Then<PreviewWorld>('the code shows the literal text {string}', function (expected: string) {
  const shown = this.html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
  assert.ok(shown.includes(expected), `expected the code block to show "${expected}"`);
});

// ---- links ---------------------------------------------------------------

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

// ---- safety --------------------------------------------------------------

Then<PreviewWorld>('the script tag is shown as text, not run', function () {
  assert.ok(this.html.includes('&lt;script&gt;'), 'expected the tag to be escaped and visible');
  assert.ok(!/<script[\s>]/.test(this.html), 'a live <script> element reached the page');
});

Then<PreviewWorld>('the comment disappears from the preview', function () {
  assert.ok(!this.html.includes('hidden'), 'the HTML comment leaked into the rendered page');
});
