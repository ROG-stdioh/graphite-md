import MarkdownIt from 'markdown-it';
import type { Token } from 'markdown-it';
// The six plugins below ship no types of their own. Their shapes are declared
// in src/types/markdown-it-plugins.d.ts, read from the installed packages —
// which is why there is no suppression directive on any of these lines.
import texmath from 'markdown-it-texmath';
import type { TexmathOptions } from 'markdown-it-texmath';
import markdownItSup from 'markdown-it-sup';
import markdownItSub from 'markdown-it-sub';
import markdownItIns from 'markdown-it-ins';
import markdownItMark from 'markdown-it-mark';
import markdownItFootnote from 'markdown-it-footnote';
import katex from 'katex';
import hljs from 'highlight.js';
// TocNode lives in the shared contract, not here: it is the shape of the
// outline data that crosses to the webview, so the host and the webview have to
// name the same type or the guard in protocol.ts is checking something else.
import type { TocNode } from './shared/protocol';
// The sink, not a channel: `log` is a module-level forwarder whose default is
// `console`, because this file is loaded by the check scripts and the BDD suite
// with no editor around it. `activate()` calls setLogger to point it at the
// Output Channel. See src/logger.ts.
import { log } from './logger';

export interface RenderResult {
  html: string;
  headings: TocNode[];
  tables: TocNode[];
  diagrams: TocNode[];
}

/**
 * What the host lends the renderer for one render.
 *
 * The renderer is a pure `string -> string` function and has no idea where the
 * document it is rendering lives, which is fine for everything except images: a
 * relative `src` has to be resolved against the document's own folder before
 * the webview can load it, and only the host knows that folder.
 */
export interface RenderEnv {
  /**
   * Turns a `src` written in the document into one the webview can load.
   *
   * Returning `undefined` means "leave it exactly as written" — the host has
   * decided this source is not one it will serve, and the page's CSP is what
   * refuses it. That is the channel the remote-image setting works through: a
   * blocked image stays blocked here and is never silently rewritten.
   */
  resolveImage?: (src: string) => string | undefined;
}

// One markdown-it instance is enough; it holds no per-render state itself —
// all per-render bookkeeping (counters, section stack) lives in renderMarkdown().
const md: MarkdownIt = new MarkdownIt({
  // Raw HTML renders. That is what every other Markdown renderer does — GitHub,
  // every static site generator, and VS Code's own preview, which is built as
  // `new MarkdownIt({ html: true })` — so `<mark>`, `<kbd>`, `<details>` and a
  // hand-written `<table>` all work everywhere except here. A document that
  // looked right in every other tool looked wrong only in this one, with
  // nothing in the source to hint at why.
  //
  // This flag is not the safety boundary, and treating it as one was the
  // mistake. `html` decides what gets *rendered*, not what gets *run*: the
  // page's policy is `script-src 'nonce-…'` with no `'unsafe-inline'`, so an
  // inline `<script>` or an `onclick=` attribute cannot execute whether this is
  // true or false, and `default-src 'none'` blocks `<iframe>` either way. See
  // the CSP in src/webviewHtml.ts, which is where that decision actually lives
  // and where the scenarios that hold it live too.
  html: true,
  linkify: true,
  typographer: true,
  // Syntax highlighting for fenced code blocks. Returning '' tells
  // markdown-it to fall back to its own plain escaping, so an unknown
  // language (or any highlight.js hiccup) degrades to the old monochrome
  // output instead of failing the render.
  highlight(str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
      } catch {
        // fall through to plain
      }
    }
    return '';
  },
});

// Auto-link only what is unambiguously a link.
//
// markdown-it's default "fuzzy" mode turns any bare `word.tld` into a link,
// and a lot of country TLDs are also file extensions — .md (Moldova), .sh
// (Saint Helena), .rs, .pl, .so, .cc, .ml. So a document that merely mentions
// README.md, setup.sh or lib.so renders those words as links to
// http://README.md, http://setup.sh, http://lib.so — which are real domains
// belonging to other people, and which the preview happily opened in a
// browser when clicked. In a Markdown preview, "*.md" is overwhelmingly a
// filename, so fuzzy matching costs far more than it buys.
//
// Explicit schemes (http://, https://, mailto:) and bare email addresses are
// matched by separate, non-fuzzy rules and still linkify.
md.linkify.set({ fuzzyLink: false });

// Registering a plugin runs at module load time — if it throws, the whole
// extension fails to even load (this file is require()'d from extension.ts
// before activate() runs), which is a much worse failure mode than "the
// syntax isn't rendered". Guard each one so a plugin problem degrades
// gracefully instead of taking the entire extension down.
try {
  md.use(
    texmath,
    // `satisfies` rather than a bare literal: md.use's own generic infers its
    // type parameter from this argument, so without it the check is skipped and
    // a misspelled delimiter set silently renders no math.
    {
      engine: katex,
      delimiters: 'dollars',
      katexOptions: { throwOnError: false },
    } satisfies TexmathOptions
  );
} catch (err) {
  log.error('failed to register markdown-it-texmath, math rendering will be disabled', err);
}
try {
  md.use(markdownItSup); // ^2^
} catch (err) {
  log.error('failed to register markdown-it-sup, superscripts will be disabled', err);
}
try {
  md.use(markdownItSub); // ~2~
} catch (err) {
  log.error('failed to register markdown-it-sub, subscripts will be disabled', err);
}
try {
  md.use(markdownItIns); // ++underline++
} catch (err) {
  log.error('failed to register markdown-it-ins, ++underlines++ will be disabled', err);
}
try {
  md.use(markdownItMark); // ==mark==
} catch (err) {
  log.error('failed to register markdown-it-mark, ==marks== will be disabled', err);
}
try {
  md.use(markdownItFootnote);
} catch (err) {
  log.error('failed to register markdown-it-footnote, footnotes will be disabled', err);
}

// ---- blockquote -> .callout -------------------------------------------------
md.renderer.rules.blockquote_open = () => `<blockquote class="callout">`;

// ---- every id this render has handed out ------------------------------------
// Two elements sharing an id is not a visible rendering error, it is a silent
// redirection: getElementById returns whichever came first, so every outline
// target and anchor click that names that id goes somewhere else, with nothing
// in the log to say so.
//
// The ids below are allocated from opposite ends. A section body is its
// heading's slug behind a `body-` prefix, `table-1`/`diagram-1` come off a
// counter, and a heading's own anchor is the bare slug — which is the anchor
// every author writes and every other Markdown renderer produces, so it is the
// one that cannot be abbreviated. That puts `## Table 1` in line for the name
// the first table is about to take, and `## Body Text` in line for the id of a
// section called "Text". Both are ordinary headings, so neither is left to a
// coin toss. Reset with the counters at the top of renderMarkdown.
const claimedIds = new Set<string>();

/** Reserves `base`, or the next free `base-N` when something already holds it. */
function claimId(base: string): string {
  let id = base;
  for (let n = 1; claimedIds.has(id); n++) id = `${base}-${n}`;
  claimedIds.add(id);
  return id;
}

// ---- table -> .md-table, and an id assigned after the fact ------------------
// No id is assigned here. This rule fires in *render* order, and a section
// holding a table written in raw HTML next to one written in Markdown is
// numbered by two different passes — so leaving the id to this rule would
// allocate the Markdown table's first whatever order they appear in, and the
// Tables tab would list them backwards. The id comes from one scan over the
// finished HTML instead (collectTables, below), which is the only place in the
// renderer a table is given a name.
//
// The class is a hook and only a hook: preview.css styles every table in the
// pane, so nothing depends on it and nothing should start to.
md.renderer.rules.table_open = () => `<table class="md-table">`;

// A `<table` that opened a tag, and the id that tag may already carry.
//
// The lookahead rather than a `\b`, because a word boundary sits between the
// `-` and the `w` of `<table-widget>` — a custom element is not a table, and an
// outline entry that scrolls to one is worse than no entry at all. What follows
// a real tag name is always a space, a `>` or a `/`.
//
// The leading `\s` in the id pattern is the same idea in the other direction:
// `\bid` matches the id in `data-id`, so a `<table data-id="grid">` would read
// as a table that already had a name. It is captured rather than merely
// matched, because replacing an id has to put that whitespace back or the new
// attribute runs into the one before it.
const TABLE_TAG = /<table(?=[\s/>])[^>]*>/gi;
const TABLE_ID = /(\s)id\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

let tableCounter = 0;

/**
 * The next free `table-N`.
 *
 * The counter keeps its shape even when it has to step over a name a heading
 * claimed, because the shape is what the Tables tab is built from — a bumped
 * `table-1-1` would read as something else entirely. claimId cannot do this: it
 * suffixes the whole base, which is right for `body-text-1` and wrong here.
 */
function claimTableId(): string {
  do {
    tableCounter += 1;
  } while (claimedIds.has(`table-${tableCounter}`));
  const id = `table-${tableCounter}`;
  claimedIds.add(id);
  return id;
}

/** A `<table>` tag's own `id`, whichever quote style it was written in. */
function authoredTableId(tag: string): string | undefined {
  const m = TABLE_ID.exec(tag);
  return m?.[2] ?? m?.[3];
}

/**
 * A `<table>` tag carrying `id`.
 *
 * An id it already had is replaced rather than added to: two `id` attributes on
 * one tag is not a rendering error, it is a silent misdirection — the browser
 * takes the first and the outline targets the second. The quote style the
 * author used is kept, so a tag that is being given the name it already had
 * comes back out unchanged.
 */
function withTableId(tag: string, id: string): string {
  const m = TABLE_ID.exec(tag);
  if (m === null) return tag.replace(/^<table/i, `<table id="${id}"`);
  const quote = m[2] === undefined ? "'" : '"';
  const end = m.index + m[0].length;
  return `${tag.slice(0, m.index)}${m[1] ?? ' '}id=${quote}${id}${quote}${tag.slice(end)}`;
}

// Reads a token the stream guarantees is there. noUncheckedIndexedAccess
// cannot see that invariant, and both alternatives lose something: a silent
// `continue` would drop a section out of the outline with no diagnostic, and
// `!` would assert an invariant nothing enforces. Throwing is what happens
// today — a TypeError on the same line — except renderMarkdown's caller turns
// a throw into a visible error page, so the failure stays loud either way.
function at<T>(tokens: readonly T[], i: number, what: string): T {
  const t = tokens[i];
  if (t === undefined) throw new Error(`graphite.md: expected ${what} at token ${i}, found none`);
  return t;
}

// ---- fenced code: mermaid gets a live diagram div, everything else stays code
let diagramCounter = 0;
const defaultFence =
  md.renderer.rules.fence ||
  function (tokens, idx, options, _env, self) {
    return self.renderToken(tokens, idx, options);
  };
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = at(tokens, idx, 'a fence token');
  const lang = token.info.trim().toLowerCase();
  if (lang === 'mermaid') {
    // Same shape-preserving skip as table_open, and for the same reason:
    // collectDiagrams finds these ids by pattern.
    do {
      diagramCounter += 1;
    } while (claimedIds.has(`diagram-${diagramCounter}`));
    const id = `diagram-${diagramCounter}`;
    claimedIds.add(id);
    const escaped = token.content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<div class="mermaid" id="${id}">${escaped}</div>`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

// ---- inline vs. display math get slightly different card treatment ----------
// texmath/katex already emits `.katex-display` for block math and plain
// `.katex` for inline; preview.css keys off exactly those two classes, so no
// extra wrapper markup is needed here.

// ---- images: hand a source to the host before emitting it -------------------
// Left alone, markdown-it emits the `src` exactly as written. A relative URL
// inside a webview resolves against the *webview's* origin rather than the
// folder the document is in, so `![](diagram.png)` pointed at nothing and every
// image in every document was a broken box. asWebviewUri is the only thing that
// can produce a loadable URL and it needs the document's URI, so the host
// supplies a resolver through `env` and this rule asks it.
//
// A `src` it declines (anything naming a scheme) is emitted untouched — see
// RenderEnv.resolveImage for why that is a decision rather than a failure.
md.renderer.rules.image = (tokens, idx, options, env: RenderEnv, self) => {
  const token = at(tokens, idx, 'an image token');
  const src = token.attrGet('src');
  if (src !== null) {
    const resolved = env.resolveImage?.(src);
    if (resolved !== undefined) token.attrSet('src', resolved);
  }

  // markdown-it's own image rule builds `alt` here from the token's children —
  // the alt text is parsed into inline tokens, not carried as an attribute —
  // and renderToken on its own does not do that. Replacing the rule without
  // this line loads every picture correctly and describes it as "", which is a
  // worse failure than the broken box it replaced.
  token.attrSet('alt', self.renderInlineAsText(token.children ?? [], options, env));

  return self.renderToken(tokens, idx, options);
};

// ---- raw HTML: the same src treatment the Markdown syntax gets --------------
// The rule above only ever sees a Markdown image. Raw HTML arrives by a
// different door — markdown-it hands it through verbatim — and lands in the
// webview with a relative `src`, which is the broken box the rule above exists
// to prevent, arriving the other way.
//
// markdown-it splits raw HTML into two token types by where it sat in the
// source: `html_block` when the markup started its own block, `html_inline` for
// a tag inside a line of prose. Both default to returning `token.content`
// untouched, and both are overridden here.
//
// A renderer rule rather than one pass over the finished page, because a pass
// over the page cannot tell markup from a document *about* markup. A fenced or
// indented code block holding `<img src="x.png">` is a `fence` or `code_block`
// token whose `<` was escaped to `&lt;` before this file ever saw it, and
// neither rule below is handed it — so a page that documents how to write an
// image tag keeps showing it as text. An `html_inline` token is also one
// complete tag, parsed by markdown-it with CommonMark's own attribute grammar,
// which knows a `>` inside a quoted value does not end the tag.
//
// `src`, on the four elements that carry one. Two attributes are deliberately
// left alone: `srcset`, which holds a list of candidates rather than a single
// source, and `poster`, which is the frame a video draws before it plays.
// Neither is a regression — nothing resolved them before this change either.
//
// The scan inside an `html_block` is textual, and knowingly so: the input is
// HTML that markdown-it did not parse, and parsing it properly would mean
// shipping an HTML parser to change one attribute. Where that shows is a `src`
// whose own value contains a `>` — the tag ends early, the attribute no longer
// matches, and the source is left exactly as written. Unresolved rather than
// mis-resolved, which is the direction a failure here should fall.
const SRC_TAG = /<(img|video|audio|source)\b[^>]*>/gi;
const SRC_ATTR = /(\s)src\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

function resolveRawSrcs(html: string, env: RenderEnv): string {
  const resolve = env.resolveImage;
  // No resolver is a real state, not a gap: this is what the check scripts and
  // the BDD suite render with, and what the host passes for a document whose
  // folder it cannot name.
  if (resolve === undefined) return html;

  return html.replace(SRC_TAG, (tag) =>
    tag.replace(
      SRC_ATTR,
      (attr: string, lead: string, doubleQuoted: string | undefined, singleQuoted: string | undefined) => {
        // Exactly one alternative matched, so at most one of these is a string;
        // `??` covers the type rather than a case, and an empty `src=""` is a
        // string, so it is passed to the resolver rather than skipped.
        const resolved = resolve(doubleQuoted ?? singleQuoted ?? '');
        if (resolved === undefined) return attr;
        // The quote style is the author's and is kept; only the value changes.
        // A resolver returns a URL, so it cannot contain the quote delimiting it.
        const quote = doubleQuoted === undefined ? "'" : '"';
        return `${lead}src=${quote}${resolved}${quote}`;
      }
    )
  );
}

md.renderer.rules.html_block = (tokens, idx, _options, env: RenderEnv) =>
  resolveRawSrcs(at(tokens, idx, 'an html_block token').content, env);

md.renderer.rules.html_inline = (tokens, idx, _options, env: RenderEnv) =>
  resolveRawSrcs(at(tokens, idx, 'an html_inline token').content, env);

// ---- checklists: "- [ ] foo" / "- [x] foo" -> a clickable checkbox --------
// markdown-it has no built-in task list support, and existing plugins don't
// give us the source line number we need for click-to-toggle edits, so this
// is a small self-contained pass over the token stream instead of a plugin.
function applyTaskLists(tokens: Token[]): void {
  for (let i = 0; i < tokens.length; i++) {
    const t = at(tokens, i, 'a token');
    if (t.type !== 'inline' || !t.children || !t.children.length) continue;
    const first = at(t.children, 0, 'the first child of an inline token');
    if (first.type !== 'text') continue;

    const m = first.content.match(/^\[( |x|X)\]\s+/);
    if (!m) continue;

    // Both captures are mandatory in the pattern; noUncheckedIndexedAccess
    // cannot see that. Defaulting to '' is correct here, where `?? ''` would
    // have been wrong in collectTables: a missing marker means "not checked",
    // which is exactly what an empty box means, so nothing is invented.
    const [marker, box = ''] = m;
    const checked = /x/i.test(box);
    first.content = first.content.slice(marker.length);

    // walk back to the enclosing list item for its class + source line
    let line: number | undefined;
    for (let j = i - 1; j >= 0; j--) {
      const prev = at(tokens, j, 'a token');
      if (prev.type === 'list_item_open') {
        prev.attrJoin('class', 'task-list-item');
        if (prev.map) line = prev.map[0];
        break;
      }
    }

    // A cast, deliberately, not `new Token('html_inline', '', 0)`. The
    // constructor would fill in level/nesting/attrs/map/hidden, and this
    // token is read by markdown-it's inline renderer for exactly two fields,
    // type and content. The cast keeps the pushed object identical to the one
    // the untested-but-working version pushed, which is the only thing a
    // type-only refactor may claim. Token has every field this literal has, so
    // the assertion is the legal narrowing direction — no `as unknown as`.
    const checkbox = {
      type: 'html_inline',
      content: `<span class="${checked ? 'task-checkbox checked' : 'task-checkbox'}"${line !== undefined ? ` data-line="${line}"` : ''}></span>`,
    } as Token;
    t.children.unshift(checkbox);
  }
}

function slugify(text: string, seen: Map<string, number>): string {
  let base = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  if (!base) base = 'section';
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

interface Section {
  level: number;
  title: string;
  titleHtml: string;
  /**
   * The heading's own anchor: the bare slug of its text, and so the id an
   * author reaches with `#tables`. Every other Markdown renderer puts this on
   * the heading, and it is where a link into this section has to land.
   */
  anchor: string;
  /**
   * The id of the section's body element, and the handle everything inside the
   * preview navigates by — the outline's targets, `data-target` on the heading,
   * `data-id` on the wrapper. Prefixing it is what keeps it from colliding with
   * the anchor above, which is allocated in the same namespace.
   */
  bodyId: string;
  bodyTokens: Token[];
  children: Section[];
}

/**
 * Renders `source` and returns both the section HTML (nested, collapsible,
 * matching preview.css's .section / .section-head / .section-body shape)
 * and TOC data the webview's buildGraph() can consume directly.
 *
 * The first H1 is treated as the document title (rendered separately, not
 * part of the collapsible tree). Every H2+ becomes a tree node, nested by
 * heading level under the nearest preceding shallower heading.
 *
 * `env` carries what the host lends this render — see RenderEnv. The same
 * object goes to both `parse` and `render`, which is what markdown-it's own
 * `render()` does; passing a fresh literal to each, as this did before images
 * needed one, quietly denies every plugin the parse-time state it is entitled
 * to read back at render time.
 */
export function renderMarkdown(rawSource: string, env: RenderEnv = {}): RenderResult {
  tableCounter = 0;
  diagramCounter = 0;
  claimedIds.clear();
  const tables: TocNode[] = [];
  const diagrams: TocNode[] = [];

  // The source goes to markdown-it exactly as the file holds it.
  //
  // It used to be stripped of `<!-- … -->` first. With html:false a comment
  // rendered as visible `&lt;!-- … --&gt;` text, and a comment is the universal
  // "hide this" convention in both Markdown and HTML, so it was worth a
  // pre-pass to keep them off the page. That pre-pass is gone with the option
  // that needed it: with html:true a comment arrives as a real comment, which
  // the browser hides for the same reason and with the line breaks the author
  // actually wrote.
  //
  // Those line breaks are the half that has to keep working, and passing the
  // source through untouched is the strongest form of that guarantee. Every
  // line number the renderer hands back — the `data-line` a checklist box
  // carries, which is what the host edits the file with — is a position in the
  // source it parsed, so anything that shortened the source would shift every
  // line below it and point those edits at the wrong text. That is not
  // hypothetical: it is what the pre-pass did wrong before it was fixed to keep
  // the newlines, and it is what `every checkbox can be toggled in the source
  // file` in features/safety.feature exists to catch.
  const tokens = md.parse(rawSource, env);
  applyTaskLists(tokens);
  const slugs = new Map<string, number>();

  let docTitleHtml = '';
  const introTokens: Token[] = [];
  const footerTokens: Token[] = [];
  const roots: Section[] = [];
  const stack: Section[] = [];
  let sawH1 = false;
  let inFootnote = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = at(tokens, i, 'a token');

    // markdown-it-footnote hoists every [^n]: definition into one
    // footnote_block at the end of the token stream. Keep that whole block
    // out of the section tree (it would otherwise land inside the last
    // section) and render it as a document footer instead.
    if (inFootnote || t.type === 'footnote_block_open' || t.type === 'footnote_block_close') {
      footerTokens.push(t);
      if (t.type === 'footnote_block_open') inFootnote = true;
      if (t.type === 'footnote_block_close') inFootnote = false;
      continue;
    }

    // Only treat a heading as document structure when it sits at the top
    // level (t.level === 0) — i.e. not nested inside a blockquote, list
    // item, or any other container. Without this check, a heading like
    // "> ## Title" inside a blockquote gets hoisted out into its own
    // top-level collapsible section, which both breaks the heading tree
    // (the quote header shows up as a real page section) AND corrupts the
    // HTML: the blockquote_open/blockquote_close tokens end up split
    // across two different sections' bodyTokens arrays, producing
    // mismatched <blockquote> tags that the browser then "fixes" by
    // renesting large parts of the page — which is what caused the whole
    // right-hand panel to end up at the bottom of the document.
    if (t.type === 'heading_open' && t.level === 0) {
      const level = Number(t.tag.slice(1)); // "h2" -> 2
      const inline = at(tokens, i + 1, 'the inline token after a heading_open');
      const titleText = inline.content;
      const titleHtml = md.renderer.renderInline(inline.children || [], md.options, {});
      i += 2; // skip inline + heading_close

      if (level === 1 && !sawH1) {
        sawH1 = true;
        docTitleHtml = titleHtml;
        continue;
      }

      // The anchor is claimed first so the author-facing name wins any contest
      // with the section's own plumbing.
      const anchor = claimId(slugify(titleText, slugs));
      const bodyId = claimId(`body-${anchor}`);
      const section: Section = {
        level,
        title: titleText,
        titleHtml,
        anchor,
        bodyId,
        bodyTokens: [],
        children: [],
      };

      // The stack is legitimately empty before the first heading, so this is
      // real narrowing rather than an index the stream guarantees.
      let top = stack[stack.length - 1];
      while (top && top.level >= level) {
        stack.pop();
        top = stack[stack.length - 1];
      }
      const parent = stack[stack.length - 1];
      if (parent) {
        parent.children.push(section);
      } else {
        roots.push(section);
      }
      stack.push(section);
      continue;
    }

    // non-heading token: goes to the innermost open section, or the intro
    // block if we haven't hit any section-starting heading yet
    const innermost = stack[stack.length - 1];
    (innermost ? innermost.bodyTokens : introTokens).push(t);
  }

  function renderTokens(toks: Token[]): string {
    return md.renderer.render(toks, md.options, env);
  }

  // The one place a table is given an id. `table_open` deliberately emits none,
  // so this scan is the single source — see the note above that rule — and it
  // runs in document order because a section's body is rendered and scanned
  // before its children are.
  //
  // A table the author named keeps that name, so `<table id="mine">` stays the
  // anchor they can link to. It goes through the same allocator as everything
  // else rather than being taken as written, because a name can already be
  // spoken for: `id="totals"` under `## Totals` collides with the heading's own
  // anchor. The heading keeps the bare slug — that is the anchor every other
  // Markdown renderer produces for `## Totals`, and the one a reader's links
  // point at — and the table takes the next free name in that shape. Writing
  // the author's id through unconditionally would put two elements on
  // `id="totals"`, which is the silent misdirection claimedIds exists to
  // prevent and is strictly worse than an id that moved.
  function collectTables(html: string, sectionLabel: string): string {
    const targets: string[] = [];
    const scanned = html.replace(TABLE_TAG, (tag) => {
      const authored = authoredTableId(tag);
      const id = authored === undefined ? claimTableId() : claimId(authored);
      targets.push(id);
      return withTableId(tag, id);
    });
    targets.forEach((target, i) => {
      tables.push({
        label: targets.length > 1 ? `${sectionLabel} — table ${i + 1}` : sectionLabel,
        target,
      });
    });
    return scanned;
  }

  function collectDiagrams(html: string, sectionLabel: string): string {
    const matches = html.matchAll(/class="mermaid" id="(diagram-\d+)"/g);
    const ids = Array.from(matches, (m) => m[1]).filter((id): id is string => id !== undefined);
    ids.forEach((id, i) => {
      diagrams.push({ label: ids.length > 1 ? `${sectionLabel} — diagram ${i + 1}` : sectionLabel, target: id });
    });
    return html;
  }

  function renderSection(section: Section): { html: string; toc: TocNode } {
    let bodyHtml = renderTokens(section.bodyTokens);
    bodyHtml = collectTables(bodyHtml, section.title);
    bodyHtml = collectDiagrams(bodyHtml, section.title);

    const childResults = section.children.map(renderSection);
    const childrenHtml = childResults.map((c) => c.html).join('\n');

    // The anchor rides on the heading, which is where GitHub puts it and where
    // a reader clicking `#tables` expects to land — on the title, not on the
    // first line of prose underneath it.
    const html = `
<div class="section" data-id="sec-${section.bodyId}">
  <h${section.level} class="section-head" id="${section.anchor}" data-target="${section.bodyId}">
    <span class="chev">▾</span><span>${section.titleHtml}</span>
  </h${section.level}>
  <div class="section-body" id="${section.bodyId}">
    ${bodyHtml}
    ${childrenHtml}
  </div>
</div>`;

    const toc: TocNode = { label: section.title, target: section.bodyId };
    if (childResults.length) toc.children = childResults.map((c) => c.toc);
    return { html, toc };
  }

  const introHtml = renderTokens(introTokens);
  const rendered = roots.map(renderSection);
  const sectionsHtml = rendered.map((r) => r.html).join('\n');
  const footnotesHtml = footerTokens.length ? renderTokens(footerTokens) : '';
  const headings: TocNode[] = rendered.map((r) => r.toc);

  const titleBlock = docTitleHtml
    ? `<h1 class="doc-title">${docTitleHtml}</h1>`
    : '';

  // first paragraph right after the H1 reads as a subtitle, matching the
  // "title + one-liner" convention most docs use
  const introWithSubtitle = introHtml.replace(
    /^<p>/,
    '<p class="doc-sub">'
  );

  return {
    html: `${titleBlock}\n${introWithSubtitle}\n${sectionsHtml}\n${footnotesHtml}`,
    headings,
    tables,
    diagrams,
  };
}
