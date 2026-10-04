// Structural queries over the HTML the renderer produced.
//
// This suite's content assertions were patterns over a string, and a string
// cannot be asked a structural question: whether one element sits inside
// another, how many there are, what an attribute says, or whether the text
// belongs to the element or to a child of it. The cost was not hypothetical.
// The superscript scenario asserted `<sup>2</sup>` and the subscript scenario
// asserted `<sub>2</sub>`, against a document whose two markers both wrapped a
// `2` — so exchanging the two plugins satisfied both, and the scenario's entire
// subject, which marker means which tag, was unpinned.
//
// A pattern over the raw string is wrong in the other direction too. An `<img>`
// or a `<table>` written inside a fenced code block is *text* as far as the
// page is concerned, and every scan that looked for tags found it anyway.
//
// parse5 rather than a lenient parser, because the question this suite has to
// answer is what a *browser* makes of the markup. Raw HTML renders, so the
// renderer's output is handed to a browser as it stands, and a parser with
// opinions of its own would agree with the renderer instead of with the reader.
// It is a devDependency: it measures the product and never ships in it.
//
// Real `export` syntax rather than the `module.exports` that world.ts uses, and
// the difference is deliberate. world.ts needs `require` to reach esbuild, so
// it must stay CommonJS; this file imports only parse5, and an ES module is
// what makes `typeof import('./html')` a usable type at the call sites — the
// same arrangement src/settings.ts and src/sourceRef.ts are loaded under.
//
// And it lives in features/lib rather than features/support for a related
// reason. Cucumber loads every file under support/ with a dynamic `import()`,
// and Node — handed a `.ts` file whose package declares no `type` — re-parses
// an ES module and warns on every run about the overhead. Loading it only from
// the steps, which `require` it, is silent. Nothing here is support code
// anyway: it defines no step and no hook, and the suite would run without it.
import * as parse5 from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';

/** One element, named from parse5's own tree adapter rather than re-declared. */
export type El = DefaultTreeAdapterMap['element'];
/** Anything that can hold children — a fragment, a document, or an element. */
export type Root = DefaultTreeAdapterMap['parentNode'];

type AnyNode = DefaultTreeAdapterMap['node'];

// An element is the node with a tag name. Text and comment nodes carry a
// `nodeName` and no tag, so this is the whole discriminator parse5 offers, and
// it is enough.
function isElement(node: AnyNode): node is El {
  return 'tagName' in node;
}

/**
 * The parsed fragment.
 *
 * `parseFragment` rather than `parse`: what the renderer returns is the body of
 * a page and not a page. There is no `<html>` around it to parse, and a
 * document-level parse would supply one and file the content under it, in a
 * place every caller would then have to know to look.
 */
export function parseHtml(html: string): DefaultTreeAdapterMap['documentFragment'] {
  return parse5.parseFragment(html);
}

/** Every element under `root`, in document order. `root` itself is not one. */
export function allElements(root: Root, out: El[] = []): El[] {
  for (const child of root.childNodes) {
    if (isElement(child)) {
      out.push(child);
      allElements(child, out);
    }
  }
  return out;
}

/** Every element under `root` whose tag is `tag`. */
export function byTag(root: Root, tag: string): El[] {
  const wanted = tag.toLowerCase();
  return allElements(root).filter((el) => el.tagName === wanted);
}

/** Every element under `root` carrying `className` in its class attribute. */
export function byClass(root: Root, className: string): El[] {
  return allElements(root).filter((el) => classesOf(el).includes(className));
}

/**
 * The text a reader sees inside something: its own text and every descendant's,
 * entities decoded and markup gone.
 *
 * Concatenated with nothing between, which is what a browser's `textContent`
 * does — so a scenario quoting a sentence is quoting the string the reader
 * would get by selecting it, whatever the renderer wrapped it in.
 */
export function textOf(root: Root): string {
  let text = '';
  for (const child of root.childNodes) {
    if (isElement(child)) text += textOf(child);
    else if (child.nodeName === '#text') text += child.value;
  }
  return text;
}

/**
 * Every comment under `root`, in document order, as the text between the
 * markers.
 *
 * Comments are the one node type with content that is neither an element nor
 * text, so `textOf` cannot see them and `byTag` cannot find them. A scenario
 * about a comment is a scenario about a node that both of the other accessors
 * are blind to by construction.
 */
export function commentsIn(root: Root, out: string[] = []): string[] {
  for (const child of root.childNodes) {
    if (isElement(child)) commentsIn(child, out);
    else if (child.nodeName === '#comment') out.push(child.data);
  }
  return out;
}

/** One attribute's value, or undefined when the element does not carry it. */
export function attrOf(el: El, name: string): string | undefined {
  return el.attrs.find((attr) => attr.name === name)?.value;
}

/** An element's classes, as a list — empty when it carries none. */
export function classesOf(el: El): string[] {
  const value = attrOf(el, 'class');
  return value === undefined ? [] : value.split(/\s+/).filter(Boolean);
}

/** The first element under `root` with this tag, or null. */
export function firstTag(root: Root, tag: string): El | null {
  return byTag(root, tag)[0] ?? null;
}

/**
 * The first element with this tag whose text is exactly `text`.
 *
 * Exactly, rather than containing it: `<sup>20</sup>` is not the element a
 * scenario asking for `2` means, and a containment test would hand it over.
 */
export function findText(root: Root, tag: string, text: string): El | null {
  return byTag(root, tag).find((el) => textOf(el) === text) ?? null;
}

/** Whether any element with this tag holds exactly this text. */
export function hasText(root: Root, tag: string, text: string): boolean {
  return findText(root, tag, text) !== null;
}
