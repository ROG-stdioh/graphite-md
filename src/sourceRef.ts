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

interface SourceRef {
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
  /**
   * Whether a plain path starts with `/`.
   *
   * This one is a fact about the text, not a claim about where the file is —
   * the only place `/` means a filesystem root is inside a scheme. VS Code's
   * own preview reads a leading `/` as relative to the *workspace folder*, and
   * as relative to the document when the document is in no folder at all, so
   * the host has to know the author wrote one before it can decide.
   */
  rooted: boolean;
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
 *
 * `@public` is load-bearing, for the reason settings.ts's CONTENT_WIDTH_MAX
 * records: knip follows ESM imports and not the `require()` calls this repo's
 * test tooling is built on, so the BDD suite — the consumer this exists for,
 * which exercises the parsing separately from the plan built on top of it — is
 * invisible to it. The tag is knip's own escape hatch for an export it cannot
 * trace, and narrower than a file-wide exemption, which would stop reporting a
 * genuinely dead export from this module.
 */
export function parseSourceRef(src: string): SourceRef {
  const scheme = SCHEME.exec(src);
  if (scheme?.[1] !== undefined) {
    // The colon is part of the answer, matching `new URL(src).protocol`, so a
    // caller never has to re-add it to print the scheme back to someone.
    return { scheme: `${scheme[1].toLowerCase()}:`, rooted: false, path: src, fragment: '' };
  }

  const hash = src.indexOf('#');
  const path = hash === -1 ? src : src.slice(0, hash);
  return {
    scheme: undefined,
    rooted: path.startsWith('/'),
    path,
    fragment: hash === -1 ? '' : src.slice(hash + 1),
  };
}

/**
 * What the host should do with one image source.
 *
 * `refuse` means "leave it exactly as written" — the source belongs to whoever
 * wrote the document, and the page's CSP is what decides whether it loads.
 * `uri` is a source that is already a complete address. `path` is one to be
 * joined onto a base, and `from` names which base.
 *
 * `reason` distinguishes the two refusals, which look identical from here and
 * mean opposite things to a reader: an `https:` source is one the privacy
 * default is holding back, and naming the setting that releases it is the whole
 * of what can be said about it, while a `data:` source is admitted by the CSP
 * and needs no comment at all. Only the first is worth a word in the log — a
 * warning on a picture that is about to load correctly trains a reader to
 * ignore warnings.
 */
export type ImagePlan =
  | { kind: 'refuse'; reason: 'remote' | 'other' }
  | { kind: 'uri'; uri: string }
  | { kind: 'path'; path: string; from: 'folder' | 'document' };

/**
 * Decides how one image source should be read.
 *
 * `inFolder` is the single fact this needs from the editor — whether the
 * document sits inside a workspace folder — and it is a parameter rather than a
 * `vscode.workspace` call so the whole decision stays exercisable without one.
 *
 * The rules here are VS Code's own, read off its Markdown preview rather than
 * invented, because a preview that resolves a path differently from the editor
 * beside it is a preview that shows a picture the editor says is missing.
 */
export function planImageSource(src: string, inFolder: boolean): ImagePlan {
  const ref = parseSourceRef(src);

  // A `file:` URI names a file the same way a relative path does, and it is the
  // one scheme the webview cannot load for itself — so leaving it alone is not
  // respect for the author's choice, it is refusal, and silent refusal at that.
  // VS Code converts these, so this converts them too.
  if (ref.scheme === 'file:') return { kind: 'uri', uri: src };
  if (ref.scheme !== undefined) {
    const overTheNetwork = ref.scheme === 'http:' || ref.scheme === 'https:';
    return { kind: 'refuse', reason: overTheNetwork ? 'remote' : 'other' };
  }
  // A bare "#fragment" — nothing to load, and nothing setting-shaped to say
  // about it either.
  if (ref.path === '') return { kind: 'refuse', reason: 'other' };

  let path = ref.path;
  try {
    path = decodeURIComponent(ref.path);
  } catch {
    // malformed percent-encoding — use the raw form rather than failing
  }

  // A leading "/" means the workspace folder, not the filesystem root. With no
  // folder open there is nothing for it to be relative to, so it falls back to
  // the document — which is also what VS Code does, rather than refusing it.
  if (ref.rooted) return { kind: 'path', path, from: inFolder ? 'folder' : 'document' };
  return { kind: 'path', path, from: 'document' };
}
