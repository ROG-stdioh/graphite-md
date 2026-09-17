// Finding the `[ ]` in a task item's source line — the one piece of the
// click-to-toggle path that is pure string work. It lives apart from
// extension.ts so it can be tested without standing up a VS Code host, which
// is how the blockquote case went unnoticed: the renderer, the message and the
// host guard were all covered, and only this was not.

/**
 * The column at which a task item's `[ ]` / `[x]` marker starts, or `undefined`
 * if this line is not a task item.
 *
 * The whole prefix is returned rather than just the bullet offset because the
 * caller replaces exactly the three characters of the marker: an index that
 * landed anywhere else would rewrite the bullet or the quote instead of the
 * box.
 */
export function taskMarkerColumn(lineText: string): number | undefined {
  const match = lineText.match(/^(\s*[-*+]\s+)\[[ xX]\]/);
  if (!match) return undefined;

  const [, prefix] = match;
  return prefix === undefined ? undefined : prefix.length;
}
