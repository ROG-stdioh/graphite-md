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
//
// Raw HTML renders, so nothing here asserts that markup is *absent* — that
// would be asserting the bug. What it asserts is that the markup arrives and
// that the page the webview loads refuses to act on it. The renderer's half is
// a string in `this.html`; the page's half is the policy in src/webviewHtml.ts,
// built by the real module rather than a copy of it.

Then<PreviewWorld>('the {word} element is passed through as markup', function (tag: string) {
  assert.ok(
    new RegExp(`<${escapeRe(tag)}[\\s>]`, 'i').test(this.html),
    `expected a live <${tag}> element in the rendered HTML, but the tag came through escaped`
  );
});

Then<PreviewWorld>('the {word} attribute is passed through as markup', function (name: string) {
  assert.ok(
    new RegExp(`\\s${escapeRe(name)}\\s*=`, 'i').test(this.html),
    `expected a live ${name}= attribute in the rendered HTML, but it came through escaped`
  );
});

Then<PreviewWorld>('the comment saying {string} reaches the page as a real comment', function (text: string) {
  assert.ok(
    new RegExp(`<!--[\\s\\S]*?${escapeRe(text)}[\\s\\S]*?-->`).test(this.html),
    `expected ${JSON.stringify(text)} inside a real HTML comment, but no comment reached the page`
  );
  assert.ok(
    !this.html.includes('&lt;!--'),
    'a comment came through escaped, so a reader would see the markup rather than the page hiding it'
  );
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

  // A policy naming a nonce is only half of it. The page's own two scripts have
  // to carry that same nonce, or the policy is signed with a key nothing holds
  // and the preview's own code is refused alongside the document's — a blank
  // panel with a policy that looks correct in the source.
  for (const file of ['vendor/mermaid.min.js', 'preview.js']) {
    // `[^"]*` on both sides of the name, because the URL carries a `?v=` query
    // string after it — the version, which is scripts/media-version-check.ts's
    // subject rather than this one's.
    const tag = new RegExp(`<script[^>]*src="[^"]*${escapeRe(file)}[^"]*"[^>]*>`, 'i').exec(page)?.[0];
    assert.ok(tag, `the page carries no <script> for ${file}`);
    assert.ok(
      tag.includes(`nonce="${nonce}"`),
      `the page's own ${file} is not signed with the policy's nonce: ${tag}`
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

Then<PreviewWorld>('the page loads media from nowhere but itself', function () {
  const policy = policyIn(this.buildPage());
  const sources = directive(policy, 'media-src').split(/\s+/).filter(Boolean);
  const imageSources = directive(policy, 'img-src').split(/\s+/).filter(Boolean);

  // Compared against img-src rather than against a list written here, because
  // agreeing with img-src is the actual property: media is a source out of the
  // document exactly as a picture is, so it crosses the same boundary and
  // answers to the same setting. A copy of the expected sources would be a
  // second place to keep in step, and would pass while the two directives
  // drifted apart.
  assert.deepStrictEqual(
    sources,
    imageSources,
    `media-src admits ${JSON.stringify(sources)} while img-src admits ` +
      `${JSON.stringify(imageSources)} — the setting that holds one back has to hold both back`
  );

  // Whole sources, not a substring: the stand-in origin is itself an `https:`
  // URL, so `mediaSrc.includes('https:')` is true whichever way this goes.
  assert.ok(
    !sources.includes('https:'),
    `media-src admits the whole network, and remote images are off: media-src ${sources.join(' ')}`
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
