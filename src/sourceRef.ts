// Taking apart a source an author wrote in a document — an image `src`, a link
// `href` — far enough for the host to decide what it is allowed to do with it.
//
// Pure string work, and deliberately outside extension.ts: that file cannot be
// loaded without a running VS Code, so anything left inside it is untestable
// until there are integration tests. This is the half of the image decision
// worth testing, and the same two rules were sitting inline and uncovered in
// extension.ts's openLink when an image turned out never to load.

/**
 * A scheme at the very start, keeping its colon: `https:`, `data:`, `file:`.
 *
 * `[a-z][a-z0-9+.-]*` is the scheme grammar from RFC 3986. A Windows drive
 * letter satisfies it as well — `C:\pics\x.png` yields the scheme `c:` — and is
 * then treated as what it looks like: an absolute reference the author wrote,
 * which the preview leaves alone exactly as it leaves `file:` and `https:`
 * alone. This module reports what a source *looks like*, not what it means; the
 * host decides what to do about it, and it only ever rewrites a relative path.
 */
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

export interface SourceRef {
  /**
   * The scheme the author wrote, lower-cased and keeping its colon, or
   * `undefined` when the source is a plain path.
   *
   * The distinction is the whole point: a source that names a scheme belongs to
   * whoever wrote the document and is passed through untouched, while a source
   * without one is a path relative to the document, which the host has to
   * resolve against the file it came from.
   */
  scheme: string | undefined;
  /** The source with any `#fragment` removed. */
  path: string;
  /** The fragment itself, without the `#`, or `''` when there was none. */
  fragment: string;
}

/**
 * Splits a source into the scheme it names (if any), its path, and its
 * fragment.
 *
 * A source that names a scheme is not split on `#` at all. A `data:` URI is
 * opaque and may contain one — `data:image/svg+xml,<svg id="#x">` is a
 * perfectly ordinary thing to write — and cutting there would corrupt it. A
 * fragment on a scheme'd source is the author's business rather than the
 * host's, so only a plain path is taken apart.
 */
export function parseSourceRef(src: string): SourceRef {
  const scheme = SCHEME.exec(src);
  if (scheme?.[1] !== undefined) {
    // The colon is part of the answer, matching `new URL(src).protocol`, so a
    // caller never has to re-add it to print the scheme back to someone.
    return { scheme: `${scheme[1].toLowerCase()}:`, path: src, fragment: '' };
  }

  const hash = src.indexOf('#');
  if (hash === -1) return { scheme: undefined, path: src, fragment: '' };
  return { scheme: undefined, path: src.slice(0, hash), fragment: src.slice(hash + 1) };
}
