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

export interface TocNode {
  label: string;
  target: string;
  children?: TocNode[];
}

export interface RenderResult {
  html: string;
  headings: TocNode[];
  tables: TocNode[];
  diagrams: TocNode[];
}

// One markdown-it instance is enough; it holds no per-render state itself —
// all per-render bookkeeping (counters, section stack) lives in renderMarkdown().
const md: MarkdownIt = new MarkdownIt({
  html: false,
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
  console.error('graphite.md: failed to register markdown-it-texmath, math rendering will be disabled', err);
}
try {
  md.use(markdownItSup); // ^2^
} catch (err) {
  console.error('graphite.md: failed to register markdown-it-sup, superscripts will be disabled', err);
}
try {
  md.use(markdownItSub); // ~2~
} catch (err) {
  console.error('graphite.md: failed to register markdown-it-sub, subscripts will be disabled', err);
}
try {
  md.use(markdownItIns); // ++underline++
} catch (err) {
  console.error('graphite.md: failed to register markdown-it-ins, ++underlines++ will be disabled', err);
}
try {
  md.use(markdownItMark); // ==mark==
} catch (err) {
  console.error('graphite.md: failed to register markdown-it-mark, ==marks== will be disabled', err);
}
try {
  md.use(markdownItFootnote);
} catch (err) {
  console.error('graphite.md: failed to register markdown-it-footnote, footnotes will be disabled', err);
}

// ---- blockquote -> .callout -------------------------------------------------
md.renderer.rules.blockquote_open = () => `<blockquote class="callout">`;

// ---- table -> .md-table + a stable id, so the Tables TOC tab can link to it --
let tableCounter = 0;
md.renderer.rules.table_open = () => {
  tableCounter += 1;
  return `<table class="md-table" id="table-${tableCounter}">`;
};

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
    diagramCounter += 1;
    const id = `diagram-${diagramCounter}`;
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
  id: string;
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
 */
export function renderMarkdown(rawSource: string): RenderResult {
  tableCounter = 0;
  diagramCounter = 0;
  const tables: TocNode[] = [];
  const diagrams: TocNode[] = [];

  // We render with html:false (raw HTML is disabled — a markdown preview
  // shouldn't execute arbitrary HTML/script from the file it's rendering).
  // The one thing people still expect to work from plain HTML is comments,
  // since "<!-- note -->" is the universal "hide this" convention in both
  // Markdown and HTML. With html:false those would otherwise leak into the
  // page as visible escaped text (`&lt;!-- note --&gt;`), so we strip them
  // before parsing rather than turning raw HTML rendering on just for this.
  const source = rawSource.replace(/<!--[\s\S]*?-->/g, '');

  const tokens = md.parse(source, {});
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

      const id = `body-${slugify(titleText, slugs)}`;
      const section: Section = { level, title: titleText, titleHtml, id, bodyTokens: [], children: [] };

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
    return md.renderer.render(toks, md.options, {});
  }

  function collectTables(html: string, sectionLabel: string): string {
    // tableCounter was already advanced by the renderer; just label the ones
    // that landed in this section's HTML by scanning for the ids we assigned
    const matches = html.matchAll(/id="(table-\d+)"/g);
    // The capture is mandatory in the pattern, so the filter never drops
    // anything — it is how the type says so. `?? ''` would instead invent an
    // empty target that the outline would then try to scroll to.
    const ids = Array.from(matches, (m) => m[1]).filter((id): id is string => id !== undefined);
    ids.forEach((id, i) => {
      tables.push({ label: ids.length > 1 ? `${sectionLabel} — table ${i + 1}` : sectionLabel, target: id });
    });
    return html;
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

    const html = `
<div class="section" data-id="sec-${section.id}">
  <h${section.level} class="section-head" data-target="${section.id}">
    <span class="chev">▾</span><span>${section.titleHtml}</span>
  </h${section.level}>
  <div class="section-body" id="${section.id}">
    ${bodyHtml}
    ${childrenHtml}
  </div>
</div>`;

    const toc: TocNode = { label: section.title, target: section.id };
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
