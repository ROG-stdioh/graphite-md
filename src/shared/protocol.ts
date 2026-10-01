/**
 * The contract between the extension host and the webview.
 *
 * Types are erased at build time, so these declarations are only half the
 * contract. The guards below are the other half, and they are the half that
 * actually holds when a message arrives: neither side may believe its own
 * annotations about anything that crossed the boundary, because the host and
 * the webview are separate scripts in separate contexts.
 *
 * Both programs compile this file — the host program through tsconfig.json, the
 * webview through src/webview/tsconfig.json — so the two cannot drift apart
 * without one of them failing to build. It imports nothing, which is what makes
 * it safe to bundle into the browser context where the `vscode` module does not
 * exist.
 */

/** One entry in the outline: a heading, a table or a diagram. */
export interface TocNode {
  label: string;
  target: string;
  children?: TocNode[];
}

/** Everything the webview needs to draw its outline, sent once at load. */
export interface PreviewData {
  headings: TocNode[];
  tables: TocNode[];
  diagrams: TocNode[];
}

/** Host -> webview. */
export type HostToWebview = { type: 'contentWidth'; value: number };

/**
 * Webview -> host.
 *
 * `log` exists because the webview has no other way to reach the user: its own
 * console is invisible unless DevTools is open, so a diagram that failed to
 * draw is silent, and silence is indistinguishable from "still working" — the
 * exact question the Output Channel is opened to answer. The host treats the
 * message as hostile in both directions: bounded, one-lined, and never given a
 * stack it could not have earned. See `oneLine` in src/logger.ts.
 */
export type WebviewToHost =
  | { type: 'toggleTask'; line: number; checked: boolean }
  | { type: 'openLink'; href: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Dispatches on the `type` tag to the checker for that variant.
 *
 * The checkers parameter is widened to `Record<string, …>` here on purpose: both
 * call sites pass a `Record<Union['type'], …>`, which is total, so a variant
 * added to a union without a checker is a compile error at the declaration
 * rather than a message that silently never arrives — the failure mode a
 * `switch` with `default: return false` would hide, since a switch over
 * `unknown` cannot be checked for exhaustiveness.
 *
 * Object.hasOwn is what makes the widening honest: the key is known to exist
 * before the lookup, so `checkers[type]` is only ever `undefined` if the
 * widening lied.
 */
function matchesVariant(
  checkers: Record<string, (v: Record<string, unknown>) => boolean>,
  value: Record<string, unknown>
): boolean {
  const { type } = value;
  if (typeof type !== 'string') return false;
  if (!Object.hasOwn(checkers, type)) return false;
  const check = checkers[type];
  return check !== undefined && check(value);
}

const webviewToHostCheckers: Record<WebviewToHost['type'], (v: Record<string, unknown>) => boolean> = {
  toggleTask: (v) => typeof v.line === 'number' && typeof v.checked === 'boolean',
  openLink: (v) => typeof v.href === 'string',
  // The level is checked against the three names this union admits rather than
  // for being a string: the host maps it onto a fixed set of channel methods,
  // and a string that is not one of the three has nowhere to go.
  log: (v) =>
    (v.level === 'info' || v.level === 'warn' || v.level === 'error') && typeof v.message === 'string',
};

const hostToWebviewCheckers: Record<HostToWebview['type'], (v: Record<string, unknown>) => boolean> = {
  contentWidth: (v) => typeof v.value === 'number',
};

/**
 * Narrows a message the webview sent. Everything that crosses this boundary is
 * `unknown` — onDidReceiveMessage is typed `any`, and it is telling the truth.
 */
export function isWebviewToHost(value: unknown): value is WebviewToHost {
  return isRecord(value) && matchesVariant(webviewToHostCheckers, value);
}

/**
 * Narrows a message the host sent, on the webview's side of the same wire.
 *
 * This one is not defensive theatre: the host is the extension the user
 * installed, but the message still arrives as `MessageEvent.data`, which is
 * `any`, and a webview that trusts it is trusting a value it has never seen.
 */
export function isHostToWebview(value: unknown): value is HostToWebview {
  return isRecord(value) && matchesVariant(hostToWebviewCheckers, value);
}

function isTocNode(value: unknown): value is TocNode {
  if (!isRecord(value)) return false;
  if (typeof value.label !== 'string' || typeof value.target !== 'string') return false;
  if (value.children === undefined) return true;
  return isTocNodeArray(value.children);
}

function isTocNodeArray(value: unknown): value is TocNode[] {
  return Array.isArray(value) && value.every((child: unknown) => isTocNode(child));
}

/**
 * Narrows `window.__PREVIEW_DATA__`, the largest surface either side reads: it
 * is a JSON literal injected into the page by the host's HTML template, so from
 * the webview's point of view it is a value that arrived from outside, and the
 * outline is built by walking it recursively. A malformed node deep in the tree
 * would otherwise surface as a TypeError partway through building the outline,
 * leaving a half-drawn graph.
 */
export function isPreviewData(value: unknown): value is PreviewData {
  if (!isRecord(value)) return false;
  return isTocNodeArray(value.headings) && isTocNodeArray(value.tables) && isTocNodeArray(value.diagrams);
}
