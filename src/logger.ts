/**
 * Where the extension's own diagnostics go.
 *
 * The destination is the `graphite.md` Output Channel — a product feature, so a
 * user can open it and read back what the extension has been doing since it
 * started. The sink is settable rather than constructed here because the
 * renderer has to be loadable without an editor: `src/markdown.ts` cannot
 * import `vscode` at all, since features/support/world.ts and
 * scripts/render-check.ts both bundle it with no `external`, so a `vscode`
 * import fails the esbuild bundle and takes `npm run check` and
 * `npm run test:bdd` down with it. Typecheck, lint and knip would all stay
 * green. Nothing in this file imports anything, which is what lets the same
 * code run in the extension host, in the check scripts and in the BDD suite.
 */

/**
 * The whole surface a caller gets, deliberately smaller than
 * `vscode.LogOutputChannel`: a module that only ever reports failures has no
 * business reaching `show()`.
 */
export interface Logger {
  info(message: string): void;
  debug(message: string): void;
  warn(message: string, cause?: unknown): void;
  error(message: string, cause?: unknown): void;
}

/**
 * Passing an explicit `undefined` as a cause prints it, as a trailing
 * "undefined"; leaving the argument off prints nothing.
 */
function asArgs(cause: unknown): unknown[] {
  return cause === undefined ? [] : [cause];
}

/**
 * The default, and what every call lands on before `activate()` has run.
 *
 * Not a black hole: in the extension host `console.error` is wired to VS Code's
 * own "Extension Host" output channel, so a message arriving here is still
 * recoverable by a user who knows to look. It is the fallback, not the
 * destination.
 */
const toConsole: Logger = {
  info: (message) => {
    console.info(message);
  },
  debug: (message) => {
    console.debug(message);
  },
  warn: (message, cause) => {
    console.warn(message, ...asArgs(cause));
  },
  error: (message, cause) => {
    console.error(message, ...asArgs(cause));
  },
};

let current: Logger = toConsole;

/**
 * Points every later call at a different sink. Called once, from `activate()`.
 *
 * Later calls only. The six sites in src/markdown.ts fire while that module is
 * being imported, which happens before `activate()` is entered — so they land
 * on the console default by construction. That is correct rather than a gap:
 * they fire only when a markdown-it plugin failed to register, at which point
 * the extension is in no state to be logging anywhere more useful, and the
 * console they land on is the one VS Code shows as the Extension Host log.
 */
export function setLogger(logger: Logger): void {
  current = logger;
}

/**
 * The sink as a value rather than three functions, so a call site reads like
 * the console it stands in for.
 *
 * A forwarding object rather than a re-export of `current`, because an imported
 * binding is copied: exporting the variable itself would hand every importer
 * whichever sink existed when they were loaded, which is the console, always.
 */
export const log: Logger = {
  info: (message) => {
    current.info(message);
  },
  debug: (message) => {
    current.debug(message);
  },
  warn: (message, cause) => {
    current.warn(message, cause);
  },
  error: (message, cause) => {
    current.error(message, cause);
  },
};

/**
 * A message and its cause joined into one string.
 *
 * `LogOutputChannel.error` renders an `Error` as its stack, but it takes a
 * single first argument — a message and a cause cannot both be passed without
 * assuming how VS Code joins them. Doing the joining here makes it a contract
 * the BDD suite holds rather than an assumption about a renderer, and it is
 * what keeps the stack attached to the sentence explaining it.
 */
export function describeCause(message: string, cause: unknown): string {
  if (cause === undefined) return message;
  if (cause instanceof Error) return `${message}: ${cause.stack ?? `${cause.name}: ${cause.message}`}`;
  if (typeof cause === 'string') return `${message}: ${cause}`;
  // Named rather than left to JSON.stringify, which returns undefined for both
  // despite its type claiming a string — so the fallback has to be reachable by
  // a route the compiler can see, and this is the honest one: these are the two
  // values that have nothing to serialise.
  if (typeof cause === 'function' || typeof cause === 'symbol') {
    return `${message}: ${Object.prototype.toString.call(cause)}`;
  }
  try {
    return `${message}: ${JSON.stringify(cause)}`;
  } catch {
    // A cyclic structure, or a toJSON that throws. One bad value should cost
    // its own detail, not the line that says something went wrong at all.
    return `${message}: (unserialisable)`;
  }
}

/** Longest a message from the webview may be, before the ellipsis. */
const REMOTE_MESSAGE_MAX = 500;

/**
 * Collapses a message that came from the webview into one bounded line.
 *
 * The webview is a separate context and its text originates in a document, so
 * it is treated as hostile in the two ways that matter to a log. Length, first,
 * because a megabyte of mermaid error would bury everything around it. Line
 * breaks second, and that one is the real reason this exists: a message that
 * can carry a newline can forge an entry that reads as this extension saying
 * something it never said, and a log a reader cannot trust is worse than no log.
 */
export function oneLine(text: string, max: number = REMOTE_MESSAGE_MAX): string {
  const clipped = text.length > max ? `${text.slice(0, max)}… (truncated)` : text;
  let out = '';
  for (const ch of clipped) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  return out;
}
