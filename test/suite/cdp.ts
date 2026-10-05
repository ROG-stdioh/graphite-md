import * as assert from 'assert';

/**
 * The debugger connection the webview tests drive the preview through.
 *
 * There is no API for this. The extension host can post messages into a webview
 * and nothing else — it cannot read the page, click a control or see what the
 * renderer drew. Everything this repo knows about the preview's behaviour has
 * therefore been verified against a hand-built DOM double (`scripts/graph-check.ts`)
 * which is honest about what it is: a double, with no layout, whose
 * `querySelectorAll` returns what the test author put there.
 *
 * VS Code is Electron, and Electron has the Chrome DevTools Protocol. Launch it
 * with `--remote-debugging-port` (see `.vscode-test.mjs`) and `GET /json/list`
 * lists the debugger targets of the running editor — including the preview
 * itself, as an iframe target with a `webSocketDebuggerUrl` of its own. Connect
 * to that, send `Runtime.evaluate`, and the expression runs inside the real
 * page: the real renderer's output, the real CSS, the real layout, the real
 * click handlers. This file is that connection, and it is what makes the
 * webview tests different in kind from every other test in the repo.
 *
 * Deliberately not a general CDP client: one command, `Runtime.evaluate`, which
 * is all the tests need. Everything else — `Runtime.enable`, event
 * subscriptions, session attachment — would be machinery with no caller.
 */

/** The port `.vscode-test.mjs` launches the editor with. */
export const DEBUG_PORT = 9333;

/** The extension id the preview's iframe target names in its own URL. */
const EXTENSION_ID = 'rog-stdioh.graphite-md';

/** How long a page is given to come back before a reconnecting evaluate gives up. */
const TARGET_TIMEOUT_MS = 10_000;

interface Target {
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

/**
 * The parts of the `WebSocket` API this file uses, spelled out rather than
 * inherited.
 *
 * The test program compiles with `lib: ["ES2022"]` and no DOM, deliberately:
 * these files run in Node, and the browser's types would let a `document`
 * reference compile here and fail at run time. Node 24 has `WebSocket` as a
 * global — verified in this suite's own host, `process.versions.node` is
 * 24.18.1 — but `@types/node` is pinned at 20, which does not declare it. So
 * the shape is written down here, and the constructor is taken off `globalThis`
 * behind a check that says something useful if a future Node drops it.
 */
interface Socket {
  send(data: string): void;
  close(): void;
  addEventListener(type: string, handler: (event: { data?: unknown }) => void): void;
}

function socketConstructor(): new (url: string) => Socket {
  const ctor = (globalThis as { WebSocket?: new (url: string) => Socket }).WebSocket;
  assert.ok(ctor, 'this Node has no global WebSocket, so the preview cannot be reached over CDP');
  return ctor;
}

/** The message the extension host is sent, so a lost connection can be named. */
const REPLACED = 'the preview was replaced while the command was in flight';

class Connection {
  private nextId = 1;
  private readonly waiting = new Map<number, { ok: (value: unknown) => void; no: (error: Error) => void }>();
  private dead = false;
  // A field assigned in the constructor rather than a parameter property:
  // `erasableSyntaxOnly` is on repo-wide, and a parameter property is one of
  // the few pieces of TypeScript that emits runtime code.
  private readonly socket: Socket;

  private constructor(socket: Socket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };
      // Events carry no id; this client subscribes to none, so anything without
      // one is not a reply to anything and is dropped.
      if (message.id === undefined) return;
      const waiting = this.waiting.get(message.id);
      if (!waiting) return;
      this.waiting.delete(message.id);
      if (message.error) waiting.no(new Error(message.error.message ?? 'the debugger reported an error'));
      else waiting.ok(message.result);
    });

    socket.addEventListener('close', () => {
      this.dead = true;
      // Whatever was in flight when the page went away will never be answered.
      // Rejecting rather than dropping them is what turns a hung test into a
      // retried one.
      for (const [, waiting] of this.waiting) waiting.no(new Error(REPLACED));
      this.waiting.clear();
    });
  }

  static async connect(url: string): Promise<Connection> {
    const socket = new (socketConstructor())(url);
    const connection = new Connection(socket);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => {
        resolve();
      });
      socket.addEventListener('error', () => {
        reject(new Error(`could not open a debugger connection to ${url}`));
      });
    });
    return connection;
  }

  get isDead(): boolean {
    return this.dead;
  }

  send(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { ok: resolve, no: reject });
      this.socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.waiting.delete(id)) reject(new Error(`${method} was not answered within 10s`));
      }, 10_000);
    });
  }
}

let current: Connection | undefined;

/** Sleep, so a poll loop does not spin the CPU of the editor it is polling. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Every debugger target the running editor is offering. */
async function targets(): Promise<Target[]> {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  return (await response.json()) as Target[];
}

/**
 * Connect, reusing the open connection when there is one.
 *
 * The preview's page is rebuilt from scratch every time the document changes —
 * the host assigns `webview.html` and the iframe reloads — so a connection that
 * was good a moment ago can be gone. Polling for the target rather than
 * demanding it immediately is what covers the gap between the two pages.
 */
async function connect(): Promise<Connection> {
  if (current && !current.isDead) return current;

  const deadline = Date.now() + TARGET_TIMEOUT_MS;
  for (;;) {
    const mine = (await targets()).filter(
      (target) => target.type === 'iframe' && target.url?.includes(`extensionId=${EXTENSION_ID}`) === true
    );
    // The newest, because during a rebuild the outgoing page can still be
    // listed for a moment after the incoming one appears.
    const target = mine.at(-1);
    if (target?.webSocketDebuggerUrl !== undefined) {
      try {
        current = await Connection.connect(target.webSocketDebuggerUrl);
        return current;
      } catch (error) {
        if (Date.now() >= deadline) throw error;
      }
    }
    if (Date.now() >= deadline) {
      assert.fail(`no debugger target for the preview after ${TARGET_TIMEOUT_MS}ms — is the preview open?`);
    }
    await sleep(100);
  }
}

/** A `Runtime.evaluate` reply, as much of it as is read here. */
interface Evaluation {
  result?: { value?: unknown };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}

/**
 * The expression, wrapped so that it runs against the *content* document.
 *
 * A webview is two documents. The debugger target owns VS Code's shell — the
 * bootstrap scripts, and an iframe it calls `fake.html` — and the page the
 * extension rendered lives inside that same-origin frame. Evaluating against
 * the target's own `document` is what a first attempt at these tests did, and
 * what it found was 39KB of `<script>` and not one `<div>`.
 *
 * Shadowing `document` with the frame's document is what keeps every
 * expression in the tests reading the way it would in a console opened on the
 * page — `document.querySelector('#contentInner')` — instead of carrying a
 * frame lookup through every assertion.
 */
function inPage(expression: string): string {
  return `((document) => (${expression}))((() => {
    const frame = document.querySelector('iframe');
    return frame && frame.contentDocument ? frame.contentDocument : document;
  })())`;
}

async function evaluateOnce<T>(expression: string): Promise<T> {
  const connection = await connect();
  const evaluation = (await connection.send('Runtime.evaluate', {
    expression: inPage(expression),
    // The value, not a remote object handle: every expression these tests send
    // is written to answer in JSON — a string, a number, a boolean, null.
    returnByValue: true,
    awaitPromise: true,
  })) as Evaluation;

  if (evaluation.exceptionDetails) {
    const { exception, text } = evaluation.exceptionDetails;
    throw new Error(`the page threw: ${exception?.description ?? text ?? 'no detail'}`);
  }
  return evaluation.result?.value as T;
}

/**
 * Run an expression inside the preview and answer with its value.
 *
 * Retried once when the connection died under it, because that is the ordinary
 * way a rebuild shows up: the expression was fine, the page it was addressed to
 * was replaced mid-flight. Anything else — a real exception in the page — is
 * thrown on the spot, since retrying a broken expression only delays the
 * message that says what broke.
 */
export async function evaluate<T>(expression: string): Promise<T> {
  try {
    return await evaluateOnce<T>(expression);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes(REPLACED)) throw error;
    current = undefined;
    return await evaluateOnce<T>(expression);
  }
}

/**
 * Poll an expression until it answers something truthy, and return that.
 *
 * The page assembles itself after the HTML arrives: mermaid draws on its own
 * schedule, the halftone waits for a layout pass, a re-render arrives a debounce
 * later. Every test here is a race against one of those, and polling is how the
 * race is won without a sleep long enough to be wrong on a slow machine.
 *
 * An expression that throws is not a "not yet": the loop lets it out.
 */
export async function waitFor<T>(what: string, expression: string, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await evaluate<T | null>(expression);
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() >= deadline) assert.fail(`timed out after ${timeoutMs}ms waiting for ${what}`);
    await sleep(100);
  }
}

/** The text of the first element matching a selector, or null. */
export function textOf(selector: string): string {
  return `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.textContent : null; })()`;
}

/** How many elements match a selector. */
export function countOf(selector: string): string {
  return `document.querySelectorAll(${JSON.stringify(selector)}).length`;
}
