// Steps for the extension's own log: joining a message to its cause, and
// bounding text that came from the webview.
//
// State lives in this module rather than on PreviewWorld. None of these steps
// renders anything, and hanging a log line off a world whose entire job is to
// hold a render would claim the two are related when they are not.
//
// The annotation and the cast are both load-bearing; see document.steps.ts for
// why. `assert.ok` is an assertion function, and TypeScript only honours the
// narrowing it performs when the binding it is called through has an explicit
// type annotation — a cast on the initializer is not a declaration, so the
// shorter form compiles and every call site reports TS2775.
const assert: typeof import('assert') = require('assert') as typeof import('assert');
const { Given, Then } = require('@cucumber/cucumber') as typeof import('@cucumber/cucumber');
// TypeScript, required directly: Node strips the types. It is why the suite
// needs Node 24, which is also what CI pins.
const { describeCause, oneLine } = require('../../src/logger.ts') as typeof import('../../src/logger');

let joined = '';
let bounded = '';
/** The unbounded text, kept so a truncation can be asserted as a comparison. */
let original = '';

Given('a log message {string} with no cause', function (message: string) {
  joined = describeCause(message, undefined);
});

Given('a log message {string} with an Error cause saying {string}', function (message: string, text: string) {
  joined = describeCause(message, new Error(text));
});

Given('a log message {string} with a cause of {string}', function (message: string, cause: string) {
  joined = describeCause(message, cause);
});

Given('a log message {string} with a cause that is a function', function (message: string) {
  joined = describeCause(message, () => undefined);
});

Given('a log message {string} with a cause that refers to itself', function (message: string) {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  joined = describeCause(message, cyclic);
});

Given('a webview message {string}', function (message: string) {
  original = message;
  bounded = oneLine(message);
});

// The docstring form, for a message that contains a real line break. {string}
// does not unescape \n — it hands over a literal backslash — which is the one
// thing a scenario about line breaks cannot work around.
Given('a webview message:', function (message: string) {
  original = message;
  bounded = oneLine(message);
});

Given('a webview message of {int} characters', function (length: number) {
  original = 'x'.repeat(length);
  bounded = oneLine(original);
});

Then('the log line is {string}', function (expected: string) {
  assert.strictEqual(joined, expected);
});

Then('the log line starts with {string}', function (prefix: string) {
  assert.ok(
    joined.startsWith(prefix),
    `expected a line starting ${JSON.stringify(prefix)}, got ${JSON.stringify(joined)}`
  );
});

// "\n    at " rather than a bare "at": every V8 stack frame is indented four
// spaces, so this is asserting that frames survived rather than that the
// letters appear somewhere in the message.
Then('the log line still carries the stack', function () {
  assert.ok(
    joined.includes('\n    at '),
    `expected a stack to survive, got ${JSON.stringify(joined)}`
  );
});

Then('the bounded line is {string}', function (expected: string) {
  assert.strictEqual(bounded, expected);
});

Then('the bounded line is shorter than the message', function () {
  assert.ok(
    bounded.length < original.length,
    `expected a shorter line, got ${bounded.length} of ${original.length}`
  );
});

Then('the bounded line ends with {string}', function (suffix: string) {
  assert.ok(
    bounded.endsWith(suffix),
    `expected a line ending ${JSON.stringify(suffix)}, got ${JSON.stringify(bounded)}`
  );
});
