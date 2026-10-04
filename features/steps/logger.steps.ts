// Steps for the extension's own log: joining a message to its cause, and
// bounding text that came from the webview.
//
// The scratch space lives on PreviewWorld rather than in this module, and the
// reason is in world.ts: a module-level binding survives the scenario that set
// it, so a Then running without its Given reads the previous scenario's value.
//
// The annotation and the cast are both load-bearing; see document.steps.ts for
// why. `assert.ok` is an assertion function, and TypeScript only honours the
// narrowing it performs when the binding it is called through has an explicit
// type annotation — a cast on the initializer is not a declaration, so the
// shorter form compiles and every call site reports TS2775.
import type { PreviewWorld } from '../support/world';

const assert: typeof import('assert') = require('assert') as typeof import('assert');
const { Given, Then } = require('@cucumber/cucumber') as typeof import('@cucumber/cucumber');
// TypeScript, required directly: Node strips the types. It is why the suite
// needs Node 24, which is also what CI pins.
const { describeCause, oneLine } = require('../../src/logger.ts') as typeof import('../../src/logger');

Given<PreviewWorld>('a log message {string} with no cause', function (message: string) {
  this.logState.line = describeCause(message, undefined);
});

Given<PreviewWorld>('a log message {string} with an Error cause saying {string}', function (message: string, text: string) {
  this.logState.line = describeCause(message, new Error(text));
});

Given<PreviewWorld>('a log message {string} with a cause of {string}', function (message: string, cause: string) {
  this.logState.line = describeCause(message, cause);
});

Given<PreviewWorld>('a log message {string} with a cause that is a function', function (message: string) {
  this.logState.line = describeCause(message, () => undefined);
});

Given<PreviewWorld>('a log message {string} with a cause that refers to itself', function (message: string) {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  this.logState.line = describeCause(message, cyclic);
});

Given<PreviewWorld>('a webview message {string}', function (message: string) {
  this.logState.original = message;
  this.logState.bounded = oneLine(message);
});

// The docstring form, for a message that contains a real line break. {string}
// does not unescape \n — it hands over a literal backslash — which is the one
// thing a scenario about line breaks cannot work around.
Given<PreviewWorld>('a webview message:', function (message: string) {
  this.logState.original = message;
  this.logState.bounded = oneLine(message);
});

Given<PreviewWorld>('a webview message of {int} characters', function (length: number) {
  this.logState.original = 'x'.repeat(length);
  this.logState.bounded = oneLine(this.logState.original);
});

Then<PreviewWorld>('the log line is {string}', function (expected: string) {
  assert.strictEqual(this.logState.line, expected);
});

Then<PreviewWorld>('the log line starts with {string}', function (prefix: string) {
  assert.ok(
    this.logState.line.startsWith(prefix),
    `expected a line starting ${JSON.stringify(prefix)}, got ${JSON.stringify(this.logState.line)}`
  );
});

// "\n    at " rather than a bare "at": every V8 stack frame is indented four
// spaces, so this is asserting that frames survived rather than that the
// letters appear somewhere in the message.
Then<PreviewWorld>('the log line still carries the stack', function () {
  assert.ok(
    this.logState.line.includes('\n    at '),
    `expected a stack to survive, got ${JSON.stringify(this.logState.line)}`
  );
});

Then<PreviewWorld>('the bounded line is {string}', function (expected: string) {
  assert.strictEqual(this.logState.bounded, expected);
});

Then<PreviewWorld>('the bounded line is shorter than the message', function () {
  assert.ok(
    this.logState.bounded.length < this.logState.original.length,
    `expected a shorter line, got ${this.logState.bounded.length} of ${this.logState.original.length}`
  );
});

Then<PreviewWorld>('the bounded line ends with {string}', function (suffix: string) {
  assert.ok(
    this.logState.bounded.endsWith(suffix),
    `expected a line ending ${JSON.stringify(suffix)}, got ${JSON.stringify(this.logState.bounded)}`
  );
});
