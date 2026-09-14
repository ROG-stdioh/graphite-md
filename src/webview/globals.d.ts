/**
 * The globals the preview is handed by the page it is loaded into, none of
 * which TypeScript knows about on its own.
 *
 * Deliberately free of any top-level import or export: either would turn this
 * file into a module, and inside a module `declare` augments rather than
 * declares — every global below would quietly stop existing.
 */

interface VsCodeApi {
  /**
   * Typed as the contract, not as `unknown`. postMessage takes `any` in the
   * real API, which would let a malformed payload leave here unchecked and be
   * rejected by the host's runtime guard in silence; typing it against
   * WebviewToHost is what makes the literal at each call site a compile-time
   * obligation instead.
   */
  postMessage(message: import('../shared/protocol').WebviewToHost): void;
  /** Whatever this file last passed to setState — genuinely unknown on the way back. */
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  run(options: { querySelector: string }): Promise<unknown>;
}

interface Window {
  /** Injected by the host's HTML template, ahead of this bundle. */
  __PREVIEW_DATA__?: unknown;
  /**
   * The mermaid bundle, loaded by its own <script> tag before this one.
   *
   * Optional on purpose. It is genuinely absent if the host stops shipping the
   * script, and declaring it optional is also what keeps `if (window.mermaid)`
   * a check the linter cannot prove is always true — the alternative is a
   * condition that reads as defensive while having quietly become decorative.
   */
  mermaid?: MermaidApi;
}
