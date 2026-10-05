// Steps for images: the contract between the renderer and the host's resolver,
// and the pure rules the host uses to decide what a source even is.
//
// See document.steps.ts for why every step takes a world type argument and
// every parameter an annotation.
import type * as Html from '../lib/html';
import type { PreviewWorld } from '../support/world';

const { allElements, attrOf, byTag, parseHtml }: typeof Html =
  require('../lib/html.ts') as typeof Html;

const assert: typeof import('assert') = require('assert') as typeof import('assert');
const { Given, Then } = require('@cucumber/cucumber') as typeof import('@cucumber/cucumber');

// parseSourceRef is pure and has no imports of its own, so Node's type
// stripping loads it directly — the same route the task-list steps take to
// taskMarkerColumn, and for the same reason: extension.ts cannot be loaded
// outside a running VS Code, and this is the half of its behaviour worth
// checking without one.
const { parseSourceRef, planImageSource } = require('../../src/sourceRef.ts') as typeof import('../../src/sourceRef');

// The feature's word for an absent value. An empty cell in an Examples table
// does not bind to a step's parameter at all, so absence needs a name.
const ABSENT = 'none';

// The tags are read off the parse rather than matched as patterns over the
// string. The patterns matched `<img …>` and `<video …>` written inside a
// fenced code block, where the angle brackets are text — so "no image reached
// the page" and "the host was never asked to resolve anything" could both be
// contradicted by a document that merely shows the markup it is talking about.

/** Every `<img>` the preview emitted, as {src, alt, title}. */
function imageTags(html: string): { src: string; alt: string; title: string }[] {
  return byTag(parseHtml(html), 'img').map((el) => ({
    src: attrOf(el, 'src') ?? '',
    alt: attrOf(el, 'alt') ?? '',
    title: attrOf(el, 'title') ?? '',
  }));
}

/** The tags a document can put a media source on. */
const MEDIA_TAGS = new Set(['video', 'audio', 'source']);

// ---- the renderer's half -------------------------------------------------

Given<PreviewWorld>('the host resolves image sources', function () {
  // An arrow inside the step keeps `this` bound to the scenario's world, so
  // what the resolver was asked for lands on the world rather than in a
  // module-level list that would leak between scenarios.
  this.imageRequests = [];
  this.imageResolver = (src: string): string => {
    this.imageRequests.push(src);
    return `resolved:${src}`;
  };
});

Given<PreviewWorld>('the host refuses every image source', function () {
  this.imageResolver = (): undefined => undefined;
});

Then<PreviewWorld>('the host was asked to resolve {string}', function (src: string) {
  assert.ok(
    this.imageRequests.includes(src),
    `the host was never asked to resolve ${JSON.stringify(src)}; it was asked for ${JSON.stringify(this.imageRequests)}`
  );
});

Then<PreviewWorld>('the image is loaded from {string}', function (expected: string) {
  const sources = imageTags(this.html).map((i) => i.src);
  assert.ok(sources.length > 0, 'no <img> reached the page at all');
  assert.ok(
    sources.includes(expected),
    `expected an image loaded from ${JSON.stringify(expected)}, got ${JSON.stringify(sources)}`
  );
});

// The `title`, which no scenario asserted. It is the tooltip rather than the
// description, so it is not the same claim as the alt text — and on the
// Markdown route it arrives from the same `![]()` as the `src` the resolver is
// handed, so a rewrite that reconstructed the tag from the resolver's answer
// would drop it while leaving both the source and the alt exactly right.
Then<PreviewWorld>('the image is captioned {string}', function (expected: string) {
  const images = imageTags(this.html);
  assert.ok(images.length > 0, 'no <img> reached the page at all');
  assert.strictEqual(
    images[0]?.title,
    expected,
    `the image is captioned ${JSON.stringify(images[0]?.title)}, expected ${JSON.stringify(expected)}`
  );
});

// The negative half of the two above, and the reason it is a step of its own:
// "nothing was rewritten" is not the same assertion as "the right thing was
// rewritten", and the failure it catches is a rewrite that reached an attribute
// it had no business touching — `data-src`, `srcset`, or a tag inside a code
// fence where the angle brackets are supposed to be text.
Then<PreviewWorld>('the host was never asked to resolve anything', function () {
  assert.deepStrictEqual(
    this.imageRequests,
    [],
    `the host was asked to resolve ${JSON.stringify(this.imageRequests)}, and nothing in this document is a source it should have rewritten`
  );
});

/** Every `<video>`/`<audio>`/`<source>` the preview emitted, in document order. */
function mediaSources(html: string): string[] {
  return allElements(parseHtml(html))
    .filter((el) => MEDIA_TAGS.has(el.tagName))
    .map((el) => attrOf(el, 'src') ?? '');
}

Then<PreviewWorld>('the video is loaded from {string}', function (expected: string) {
  const sources = mediaSources(this.html);
  assert.ok(sources.length > 0, 'no <video> reached the page at all');
  assert.ok(
    sources.includes(expected),
    `expected a video loaded from ${JSON.stringify(expected)}, got ${JSON.stringify(sources)}`
  );
});

Then<PreviewWorld>('the image is described as {string}', function (expected: string) {
  const images = imageTags(this.html);
  assert.ok(images.length > 0, 'no <img> reached the page at all');
  assert.strictEqual(
    images[0]?.alt,
    expected,
    `the image is described as ${JSON.stringify(images[0]?.alt)}, expected ${JSON.stringify(expected)}`
  );
});

// ---- the host's half -----------------------------------------------------

Given<PreviewWorld>('the source {string}', function (source: string) {
  this.refSource = source;
});

Then<PreviewWorld>('its scheme is {string}', function (expected: string) {
  const { scheme } = parseSourceRef(this.refSource);
  assert.strictEqual(
    scheme ?? ABSENT,
    expected,
    `${JSON.stringify(this.refSource)} reported the scheme ${JSON.stringify(scheme ?? ABSENT)}`
  );
});

// An empty path and an absent fragment both mean "none" to the feature, which
// is why the sentinel is applied on this side of the assertion rather than the
// table carrying a spelling for each.
Then<PreviewWorld>('its path is {string}', function (expected: string) {
  const { path } = parseSourceRef(this.refSource);
  assert.strictEqual(
    path === '' ? ABSENT : path,
    expected,
    `${JSON.stringify(this.refSource)} reported the path ${JSON.stringify(path)}`
  );
});

Then<PreviewWorld>('its fragment is {string}', function (expected: string) {
  const { fragment } = parseSourceRef(this.refSource);
  assert.strictEqual(
    fragment === '' ? ABSENT : fragment,
    expected,
    `${JSON.stringify(this.refSource)} reported the fragment ${JSON.stringify(fragment)}`
  );
});

// A leading slash is two different steps rather than one step with a boolean,
// because "the path begins with a slash" is the whole assertion — a reader
// should not have to decode "rooted is true" to find out what was checked.
Then<PreviewWorld>('the path begins with a slash', function () {
  assert.strictEqual(
    parseSourceRef(this.refSource).rooted,
    true,
    `${JSON.stringify(this.refSource)} was not reported as beginning with a slash`
  );
});

Then<PreviewWorld>('the path does not begin with a slash', function () {
  assert.strictEqual(
    parseSourceRef(this.refSource).rooted,
    false,
    `${JSON.stringify(this.refSource)} was reported as beginning with a slash`
  );
});

Given<PreviewWorld>('the document is in a folder', function () {
  this.docInFolder = true;
});

Given<PreviewWorld>('the document is in no folder', function () {
  this.docInFolder = false;
});

// The plan is flattened to one line so a table can state it: "refuse", or a
// complete address as "uri:…", or a base and a path as "document:…"/"folder:…".
// A shape rather than three columns because the three outcomes are alternatives
// — a refused source has no path to report, and a table column for it would be
// a cell that is always empty.
Then<PreviewWorld>('the plan is {string}', function (expected: string) {
  const plan = planImageSource(this.refSource, this.docInFolder);
  let actual: string;
  switch (plan.kind) {
    case 'refuse':
      actual = 'refuse';
      break;
    case 'uri':
      actual = `uri:${plan.uri}`;
      break;
    case 'path':
      actual = `${plan.from}:${plan.path}`;
      break;
  }
  assert.strictEqual(
    actual,
    expected,
    `${JSON.stringify(this.refSource)} planned ${JSON.stringify(actual)}`
  );
});
