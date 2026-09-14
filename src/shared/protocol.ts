/**
 * The contract between the extension host and the webview.
 *
 * Types are erased at build time, so these declarations are only half the
 * contract. The guard below is the other half, and it is the half that actually
 * holds when a message arrives: the host must not believe its own annotations
 * about anything the webview sent it, because the webview is a separate script
 * in a separate context — and, until it is converted, untyped JavaScript that
 * nothing checks.
 *
 * Both programs will import this. The host program compiles it today; the
 * webview program compiles it once the webview is converted, so the two cannot
 * drift apart without one of them failing to build. It imports nothing, which
 * is what makes it safe to bundle into the browser context where the `vscode`
 * module does not exist.
 *
 * The host->webview guard and the guard over __PREVIEW_DATA__ are not here yet.
 * Neither has a caller until the webview is TypeScript, and this is the release
 * that adds a dead-code detector — shipping exports nothing calls would be
 * working against the gate being added beside them.
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

/** Webview -> host. */
export type WebviewToHost =
  | { type: 'toggleTask'; line: number; checked: boolean }
  | { type: 'openLink'; href: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// Record<Union, …> is total, so a variant added to WebviewToHost without a
// checker here is a compile error rather than a message that silently never
// arrives — the failure mode a switch with `default: return false` would hide,
// since a switch over `unknown` cannot be checked for exhaustiveness.
const webviewToHostCheckers: Record<WebviewToHost['type'], (v: Record<string, unknown>) => boolean> = {
  toggleTask: (v) => typeof v.line === 'number' && typeof v.checked === 'boolean',
  openLink: (v) => typeof v.href === 'string',
};

/**
 * Narrows a message the webview sent. Everything that crosses this boundary is
 * `unknown` — onDidReceiveMessage is typed `any`, and it is telling the truth.
 */
export function isWebviewToHost(value: unknown): value is WebviewToHost {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  // Both unions are keyed by `type`, which is a plain string by the time it
  // arrives from the wire, so the lookup needs a widening the record itself
  // does not have. Object.hasOwn is what makes that widening honest: the key is
  // known to exist before it is used.
  if (!Object.hasOwn(webviewToHostCheckers, value.type)) return false;
  const check = (webviewToHostCheckers as Record<string, (v: Record<string, unknown>) => boolean>)[value.type];
  return check !== undefined && check(value);
}
