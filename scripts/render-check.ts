// Dev-only sanity check for the markdown pipeline: bundles src/markdown.ts
// with esbuild and runs it over samples/kitchen-sink.md, asserting on the HTML
// output. Not part of the extension build (which only bundles extension.ts).
// Run: node scripts/render-check.ts
//
// `require` rather than `import` keeps this file CommonJS, which is what lets
// Node run it directly; the cast reattaches the module type @types/node widens
// to `any`. See esbuild.ts for the full note.
const esbuild = require('esbuild') as typeof import('esbuild');
const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');

// The outline node shape, named here for the tree walk in the checks below. It
// lives in the shared contract, which is where src/markdown.ts takes it from
// too — an inline import query because this file is CommonJS and every other
// import in it is written the same way.
type TocNode = import('../src/shared/protocol').TocNode;

const root = path.join(__dirname, '..');
const bundle = path.join(root, 'out', 'render-check.bundle.js');
const sample = path.join(root, 'samples', 'kitchen-sink.md');

// The tags whose opening and closing counts have to agree, shared by the two
// checks that use them: the kitchen sink, where each one also has to be present
// at all, and every other sample, where it only has to pair if it appears.
const BALANCED_TAGS = [
  'div',
  'section',
  'blockquote',
  'ul',
  'ol',
  'table',
  'pre',
  'p',
  'li',
  'sup',
  'sub',
  'mark',
  'ins',
  'span',
  'kbd',
  'abbr',
  'dl',
  'dt',
  'dd',
  'details',
  'summary',
  'figure',
  'figcaption',
  'script',
  'form',
  'iframe',
  'video',
  'audio',
];

async function main(): Promise<void> {
  await esbuild.build({
    entryPoints: [path.join(root, 'src', 'markdown.ts')],
    bundle: true,
    outfile: bundle,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
  });

  // The bundle path is computed, so there is nothing for the compiler to
  // resolve; the cast names the module its contents came from, which is how the
  // result type below stays the renderer's own rather than a copy of it.
  const { renderMarkdown } = require(bundle) as typeof import('../src/markdown');

  let failures = 0;
  const check = (name: string, cond: boolean): void => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
    if (!cond) failures++;
  };

  const src = fs.readFileSync(sample, 'utf8');
  const r = renderMarkdown(src);
  const html = r.html;

  // ---- inline syntax --------------------------------------------------------
  check('sup: mc<sup>2</sup> (^2^ syntax)', /mc<sup>2<\/sup>/.test(html));
  check('sub: H<sub>2</sub>O (~2~ syntax)', /H<sub>2<\/sub>O/.test(html));
  check('ins: <ins> (++ syntax)', /<ins>underline things<\/ins>/.test(html));
  check('mark: <mark> (== syntax)', /<mark>mark them like a highlighter<\/mark>/.test(html));
  check('strikethrough <s>', /<s>strikethrough<\/s>/.test(html));
  check('mark nests inside strong', /<strong><mark>/.test(html) || /<mark><strong>/.test(html));

  // ---- the typographer ------------------------------------------------------
  // Written with the characters a keyboard has and rendered with the ones type
  // wants. Every substitution below is a markdown-it *core* rule, read while
  // parsing, which is why asserting them here also asserts that the option is
  // set before the parse rather than after it — a value written afterwards
  // changes nothing and would leave every one of these as its plain spelling.
  check(
    'typographer: curly quotes, dashes, ellipsis, symbols',
    html.includes('“Double quotes”') &&
      html.includes('‘single quotes’') &&
      html.includes('it’s a contraction') &&
      html.includes('an – en dash') &&
      html.includes('an — em dash') &&
      html.includes('an ellipsis…') &&
      html.includes('© ® ™ ±')
  );
  // The entity half of the same idea, and the escape that has to stay one:
  // `&lt;` is how a document writes a tag it does not want rendered, so it
  // arrives as text and only the entities resolve.
  check('HTML entities resolve, and an escaped tag stays text', html.includes('© &amp; — &lt;not a tag&gt;.'));

  // ---- footnotes ------------------------------------------------------------
  check('footnotes section rendered', /class="footnotes"/.test(html) && /text contents of the footnote/.test(html));
  check('footnote ref anchors (forward + backref)', /href="#fn1" id="fnref1"/.test(html) && /href="#fnref1" class="footnote-backref"/.test(html));
  check('footnote re-citation reuses one note', (html.match(/id="fn1"/g) ?? []).length === 1);

  // ---- code -----------------------------------------------------------------
  check('syntax highlighting (hljs spans)', /hljs-keyword/.test(html) && /hljs-string/.test(html));
  check('plain fence has no hljs spans', (() => {
    const blocks = html.match(/<pre[\s\S]*?<\/pre>/g) ?? [];
    const plain = blocks.find((b) => b.includes('npm install'));
    return !!plain && !/<span class="hljs-/.test(plain);
  })());
  check('unknown language degrades to plain text', (() => {
    const blocks = html.match(/<pre[\s\S]*?<\/pre>/g) ?? [];
    const unknown = blocks.find((b) => b.includes('never heard of'));
    return !!unknown && !/hljs/.test(unknown) && /&lt;angle brackets&gt;/.test(unknown);
  })());

  // ---- math and diagrams ----------------------------------------------------
  check('inline math via katex', /<span class="katex">/.test(html));
  check('display math via katex-display', /katex-display/.test(html));
  check('malformed latex does not throw', /katex/.test(html) && html.length > 1000);
  check(
    'mermaid blocks (all three diagrams)',
    ['diagram-1', 'diagram-2', 'diagram-3'].every((id) => html.includes(`class="mermaid" id="${id}"`))
  );
  // A diagram's source is escaped before it reaches the page, and a label
  // carrying `<` or `&` is what shows it: unescaped, the browser reads the
  // label as markup and the diagram does not draw at all.
  check(
    'a diagram label carrying markup characters is escaped',
    html.includes('Latency &lt; 5ms &amp; stable') && html.includes('Within budget?')
  );

  // The two `$$…$$` block rules match at the start of a line and used to consume
  // the rest of it, so text written after the closing `$$` was dropped without a
  // trace (#40). The sample has no line of that shape, so these render their own
  // documents; the last one is the control — narrowing the rules must not cost a
  // line that really is only a formula its place on the block path, which the
  // absence of a `<p>` is what shows.
  const leadingDouble = renderMarkdown('## S\n\n$$x^2$$ is the area.\n');
  check('a leading $$ formula keeps the text after it', leadingDouble.html.includes('is the area.'));
  const twoOnALine = renderMarkdown('## S\n\n$$x^2$$ and $$y^2$$ on one line.\n');
  check(
    'two $$ formulas on one line keep the text between them',
    twoOnALine.html.includes('on one line.') && (twoOnALine.html.match(/class="katex"/g) ?? []).length === 2
  );
  const aloneDouble = renderMarkdown('## S\n\n$$x^2$$\n');
  check(
    'a line that is only a $$ formula is still a block',
    /katex-display/.test(aloneDouble.html) && !/<p>/.test(aloneDouble.html)
  );

  // #41's other half, and the half a parsed tree cannot see: the browser's error
  // recovery is what puts the paragraph back together, so a repaired page looks
  // the same whether or not the markup was ever broken. Asserted on the raw
  // string instead — the `<eqn>` is inside the sentence's paragraph (the
  // positive control) and no block element is.
  const midSentenceDouble = renderMarkdown('## S\n\nThe area $$x^2$$ is large.\n');
  check(
    'a mid-sentence $$ formula is inline content, not block markup',
    /<p[^>]*>(?:(?!<\/p>)[\s\S])*<eqn\b/.test(midSentenceDouble.html) &&
      !/<p[^>]*>(?:(?!<\/p>)[\s\S])*<(?:section|div|table|pre|blockquote)\b/.test(midSentenceDouble.html)
  );

  // The same shapes again, written into the sample rather than rendered from a
  // snippet. Not redundant: the sample is what the dev-host pass reads and what
  // a person actually opens, so a fix that held only for a two-line document
  // would not survive contact with a real one — and the sample is where these
  // shapes have to keep working as the document grows around them.
  check(
    'sample: a price before a formula keeps the price and typesets the formula',
    html.includes('It costs $5, and the other one costs $10, unlike') &&
      /annotation encoding="application\/x-tex">x \+ y</.test(html)
  );
  check(
    'sample: a leading $$ keeps the text after it, and the text between two on a line',
    html.includes('is the area, and') && html.includes('both on one line.')
  );
  check('sample: a mid-sentence $$ stays inside its sentence', /<p>The area <eqn>/.test(html));
  check('sample: a $$ line of its own is a block, with no paragraph around it', /<section><eqn>/.test(html));

  // ---- raw HTML -------------------------------------------------------------
  // The sample carries a whole section of it, and the point of these is the
  // same as the point of the section: raw HTML arrives as markup rather than as
  // the markup's own text. `&lt;` anywhere in a place the document wrote `<` is
  // the failure, and it is the one a reader sees.
  check('raw HTML renders as markup', /<kbd>Ctrl<\/kbd>/.test(html) && /<abbr title="Application Programming Interface">/.test(html));
  // Matches any attributes rather than the bare `<table>` this used to look for,
  // because the scan below now puts an id on this tag — and it anchors on a cell
  // only the hand-written table carries, which is what keeps it a check about
  // the raw table rather than about Markdown tables in general.
  check('a raw HTML table renders as a table', /<table\b[^>]*>[\s\S]*?<td>Markdown parse<\/td>/.test(html));
  check('raw HTML blocks render (details/dl/figure)', /<details>/.test(html) && /<dl>/.test(html) && /<figcaption>/.test(html));
  check('comments pass through as real comments', /<!--[\s\S]*?-->/.test(html) && !html.includes('&lt;!--'));

  // A code block is where the escaping is still correct and still required: a
  // document about HTML must be able to show a tag without rendering one. Both
  // the fenced and the indented form, because they take different paths through
  // markdown-it and only one of them was ever looked at.
  check('a fenced code block still escapes markup', /&lt;angle brackets&gt;/.test(html));

  // The half the renderer owns: a `<img>` written as raw HTML is offered to the
  // host's resolver exactly as a Markdown one is. Rendered here with a resolver
  // rather than without, because without one there is nothing to observe — the
  // source is passed through untouched either way.
  const rawImg = renderMarkdown('<img src="raw.png" alt="raw">', {
    resolveImage: (src) => `resolved:${src}`,
  }).html;
  check('a raw HTML image is resolved by the host', /<img src="resolved:raw\.png" alt="raw">/.test(rawImg));
  check(
    'a raw HTML image the host declines is left alone',
    /<img src="https:\/\/example\.com\/x\.png">/.test(renderMarkdown('<img src="https://example.com/x.png">').html)
  );
  // Asserted as "not resolved" rather than as a literal string, because the
  // fenced block is highlighted: highlight.js wraps the tag in spans of its
  // own, so the exact bytes are the highlighter's business and not this
  // check's. That the source is still visible as text and was never handed to
  // the resolver is the property.
  const fenced = renderMarkdown('```html\n<img src="fenced.png">\n```', {
    resolveImage: (s) => `resolved:${s}`,
  }).html;
  check(
    'a raw HTML image inside a code fence is not resolved',
    fenced.includes('fenced.png') && !fenced.includes('resolved:fenced.png')
  );

  // Four elements carry a `src` and the rule rewrites all four, but the sample
  // can only ever demonstrate one of them: it is rendered with no resolver, so
  // a relative `src` in it comes out untouched whether the rule works or not.
  // These render their own documents with one, which is the only way to see the
  // other three — `<source>` especially, which is void, so an opening and a
  // closing tag can never be counted for it.
  const media = renderMarkdown(
    '<video src="clip.mp4"></video>\n\n<audio src="clip.mp3"></audio>\n\n<source src="clip.webm">',
    { resolveImage: (s) => `resolved:${s}` }
  ).html;
  check(
    'a raw <video>, <audio> and <source> source is resolved by the host',
    media.includes('src="resolved:clip.mp4"') &&
      media.includes('src="resolved:clip.mp3"') &&
      media.includes('src="resolved:clip.webm"')
  );

  // ---- mixed HTML and Markdown ----------------------------------------------
  // Inline HTML is transparent, so the sample puts a tag in a sentence and the
  // Markdown around it still renders.
  check(
    'inline HTML inside a Markdown paragraph renders',
    /<abbr title="Too Long; Did Not Read">/.test(html) && /<strong>bold after a tag<\/strong>/.test(html)
  );

  // The block case turns on a blank line, and the sample carries both forms
  // precisely so this can assert the difference rather than describe it: without
  // a blank line the block is raw and its Markdown is text, with one it renders.
  check(
    'Markdown inside an unblanked HTML block stays literal',
    /<div class="callout">\s*\*\*not bold\*\*/.test(html)
  );
  check('Markdown inside a blank-lined HTML block renders', /<div class="callout">\s*<p><strong>Bold<\/strong>/.test(html));

  // The same blank line decides whether a heading exists at all, and the sample
  // writes two `####` headings of which only one is a heading. A heading the
  // block above it swallowed is not merely unstyled — it is missing from the
  // outline, which is a silent failure, and that is why it is asserted rather
  // than left to the eye. `Kept` is nested under its `###`, so this has to look
  // through the tree rather than at the roots.
  const hasHeading = (label: string): boolean => {
    const anyIn = (nodes: TocNode[]): boolean =>
      nodes.some((n) => n.label.startsWith(label) || anyIn(n.children ?? []));
    return anyIn(r.headings);
  };
  check('a heading with no blank line above it never becomes one', !hasHeading('Swallowed'));
  check('a heading with a blank line above it does', hasHeading('Kept'));

  // ---- anchors --------------------------------------------------------------
  // The slug rule is GitHub's, and the sample writes the three cases that
  // separate it from a `[a-z0-9]` strip: a heading in a non-Latin script, a
  // heading that is nothing but punctuation, and two headings with the same
  // text. Each one is a link that either resolves or does not.
  check('a heading in a non-Latin script keeps its anchor', /id="café-日本語-ünïcödé-naïve"/.test(html));
  check('a heading of nothing but punctuation falls back to `section`', /id="section"/.test(html));
  check(
    'repeated headings get numbered suffixes',
    /id="repeated-heading"/.test(html) && /id="repeated-heading-1"/.test(html) && /id="repeated-heading-2"/.test(html)
  );
  check(
    'trailing hashes are stripped from the heading and from its anchor',
    hasHeading('Trailing hashes are stripped') && !hasHeading('Trailing hashes are stripped ###')
  );
  check('a setext heading is a heading like any other', hasHeading('Setext Underline Heading'));

  // ---- tables get their ids from one scan ------------------------------------
  // The Tables tab is built from these ids, so what it lists is exactly what the
  // scan found — which makes the scan the thing to assert rather than the tab.
  //
  // Every document below opens with a heading on purpose. A table written before
  // the first one lands in the intro block, which no scan covers, so a check
  // without a heading would pass whether or not the scan worked at all — it
  // would be asserting the absence of a thing that was never in scope.
  const rawTable = renderMarkdown('## T\n\n<table>\n<tr><td>a</td></tr>\n</table>').html;
  check('a raw HTML table is given an id', /<table id="table-1">/.test(rawTable));

  // Read back out of the tag rather than assumed, so a table the author named
  // keeps that name — it is the anchor they can link to, and inventing a second
  // one for it would break every link already written to it.
  const named = renderMarkdown('## T\n\n<table id="totals">\n<tr><td>a</td></tr>\n</table>');
  check('a table the author named keeps that name', /<table id="totals">/.test(named.html));
  check('and the outline targets what the author named', named.tables[0]?.target === 'totals');

  // The reason the id is assigned by a scan and not by the renderer: the two run
  // in different orders, and a section holding both syntaxes is where they
  // disagree. Raw first, Markdown second, and the numbering has to say so —
  // assigning here in render order would number them backwards and list them
  // that way.
  const both = renderMarkdown('## T\n\n<table>\n<tr><td>raw</td></tr>\n</table>\n\n| a |\n| - |\n| md |\n');
  check(
    'a raw table and a Markdown one are numbered in document order',
    both.tables.length === 2 &&
      both.tables[0]?.target === 'table-1' &&
      both.tables[1]?.target === 'table-2' &&
      both.html.indexOf('id="table-1"') < both.html.indexOf('id="table-2"')
  );

  // The scan is a regular expression over rendered HTML, so a table *shown* as
  // text is how it goes wrong: a document about HTML has to be able to write
  // `<table>` without the outline quietly gaining an entry for it. Both the
  // fenced and the indented form, because they take different paths through
  // markdown-it and only one of them was ever looked at.
  const shownAsText = renderMarkdown('## T\n\n```\n<table>\n```\n\n    <table>\n');
  check(
    'a table shown as code is neither given an id nor listed',
    shownAsText.html.includes('&lt;table&gt;') &&
      !shownAsText.html.includes('id="table-') &&
      shownAsText.tables.length === 0
  );

  // The other direction from the code case: markup that is not a table at all.
  // A word boundary sits between the `-` and the `w` here, so a pattern written
  // with `\b` would take this custom element for a table and the outline would
  // gain an entry that scrolls to something that is not one.
  const customElement = renderMarkdown('## T\n\n<table-widget rows="3"></table-widget>\n');
  check(
    'an element whose name merely starts with "table" is not a table',
    customElement.tables.length === 0 && !customElement.html.includes('id="table-1"')
  );

  // Every row the Tables tab lists has to point at an element that is actually
  // in the page. A target that is not is a row that looks like a link and does
  // nothing when it is clicked — the failure this change is about, one step
  // further on, and the one an id assigned without being written would produce.
  // The closing quote is part of the needle so `table-1` cannot be satisfied by
  // `table-11`.
  check(
    'every table target the outline lists is an element on the page',
    r.tables.length > 0 && r.tables.every((t) => html.includes(`id="${t.target}"`))
  );

  // Two ways to end up with two ids on one tag — overwriting one the author
  // wrote, and adding a class to a tag that already has one — asserted as the
  // single invariant both would break.
  const attrCount = (tag: string, attr: string): number =>
    (tag.match(new RegExp(`\\s${attr}=`, 'g')) ?? []).length;
  const tableTags = html.match(/<table\b[^>]*>/gi) ?? [];
  check(
    'no table tag carries a duplicated attribute',
    tableTags.length > 0 && tableTags.every((t) => attrCount(t, 'id') <= 1 && attrCount(t, 'class') <= 1)
  );

  // ---- structure ------------------------------------------------------------
  check('first H1 extracted as doc title', /<h1 class="doc-title">/.test(html));
  // The one-line summary under the title. The rule is "the first paragraph
  // after the H1", so the sample has to keep an ordinary paragraph second or
  // this could pass for the wrong reason.
  check(
    'the first paragraph after the title is the subtitle',
    /<p class="doc-sub">Everything the preview can render, in one file\.<\/p>/.test(html)
  );
  check('second H1 stays in the outline', r.headings.some((h) => h.label.startsWith('A Second Top-Level Heading')));
  check('quote-nested heading NOT in outline', !r.headings.some((h) => h.label.includes('Markdown Inside Quotes')));
  // `?.` rather than the `&&` chain this used to be: with the outline typed,
  // the chain's intermediate values are `TocNode | undefined` and the optional
  // form says the same thing without a narrowing step for each link.
  check('outline nests H2 -> H6 (depth 4)', (() => {
    const h2 = r.headings.find((h) => h.label.startsWith('H2: Section'));
    const h6 = h2?.children?.[0]?.children?.[0]?.children?.[0]?.children?.[0];
    return !!h6 && h6.label.startsWith('H6:');
  })());
  check('outline has multiple roots', r.headings.length >= 6);
  // Seven, not three. The sample's four Markdown tables are joined by the three
  // written by hand — including the one the document named itself.
  check('tables collected (7)', r.tables.length === 7);
  // An empty cell is not a missing one: the row keeps its shape and the borders
  // still line up. The sample writes two rows of three with two filled cells in
  // total, so six cells are the right answer and five or seven are both wrong.
  // Scoped to the one table in the sample that has any, by a pattern that cannot
  // run past its own `</table>` into the next one.
  const emptyCellTable =
    html.match(/<table[^>]*>(?:(?!<\/table>)[\s\S])*Also empty(?:(?!<\/table>)[\s\S])*<\/table>/)?.[0] ?? '';
  const bodyCells = emptyCellTable.match(/<tbody>[\s\S]*<\/tbody>/)?.[0] ?? '';
  check(
    'a table with empty cells keeps every cell',
    (bodyCells.match(/<td[^>]*>[\s\S]*?<\/td>/g) ?? []).length === 6 &&
      (bodyCells.match(/<td[^>]*><\/td>/g) ?? []).length === 4 &&
      (bodyCells.match(/<td[^>]*>a value<\/td>/g) ?? []).length === 2
  );
  check('diagrams collected (3)', r.diagrams.length === 3);
  check('task checkboxes with source lines', /task-checkbox/.test(html) && /data-line="\d+"/.test(html));
  check('checked + unchecked boxes both emitted', /task-checkbox checked/.test(html) && /class="task-checkbox"/.test(html));

  // ---- links ----------------------------------------------------------------
  // Regression: markdown-it's "fuzzy" linkify turns any bare word.tld into a
  // link, and .md / .sh / .rs / .so / .pl are all country TLDs. So a document
  // that merely mentioned README.md rendered a link to http://README.md — a
  // real domain owned by someone else — and clicking it opened their website.
  // In a Markdown preview "*.md" is a filename; these must stay plain text.
  const render = (s: string): string => renderMarkdown(s).html;
  check('bare README.md is not linkified', !/href="http:\/\/README\.md"/.test(render('See README.md for details.')));
  check('bare graphite.md is not linkified', !/href="http:\/\/graphite\.md"/.test(render('# graphite.md')));
  check('bare .sh/.rs/.so filenames are not linkified',
    !/href="http:\/\/(setup\.sh|main\.rs|lib\.so)"/.test(render('Run setup.sh, rebuild main.rs, load lib.so.')));
  check('bare domain text is not linkified', !/href="http:\/\/example\.com"/.test(render('Visit example.com for more.')));
  check('explicit https URL still linkifies', /href="https:\/\/example\.com"/.test(render('See https://example.com for more.')));
  check('bare email still linkifies', /href="mailto:me@example\.com"/.test(render('Ping me@example.com please.')));
  check('explicit relative markdown link survives', /href="setup\.md"/.test(render('Read [setup](setup.md).')));

  // The same constructs again, read back out of the sample rather than out of a
  // fixture written for the check. A sample that stopped demonstrating one of
  // these would still render, and the file's whole job is to demonstrate them,
  // so the assertion belongs on the file.
  check(
    'the sample shows why the fuzzy-link regression matters',
    html.includes('README.md, setup.sh or') && !/href="http:\/\/(README\.md|setup\.sh|main\.rs)"/.test(html)
  );
  check('the sample linkifies an email address', html.includes('href="mailto:someone@example.com"'));
  check('the sample keeps a bare domain as text', !/href="[^"]*www\.example\.com/.test(html));
  check(
    'the sample carries a titled link in both spellings',
    html.includes('title="Reference-style links carry a title too"') &&
      /title="The title rides on the link, whichever\s+spelling wrote it"/.test(html)
  );

  // ---- the sample's edge cases ----------------------------------------------
  // Each of these is a shape a renderer gets wrong quietly: the break that is
  // not a paragraph end, the ordered list that starts at 1 anyway, the item
  // wrapped in a `<p>` only because a blank line followed it, and the two
  // characters that look exactly like a checkbox and are not one.
  check(
    'both hard-break spellings render a <br>',
    html.includes('at the end of this line<br>') && html.includes('other spelling of the same break:<br>')
  );
  check('a thematic break renders as <hr>, in either spelling', (html.match(/<hr>/g) ?? []).length === 3);
  check('an ordered list keeps the start number it was given', html.includes('<ol start="3">'));
  check(
    'an item followed by a blank line is wrapped in a paragraph',
    /<li>\s*<p>An item with a blank line after it<\/p>/.test(html)
  );
  // `- [ ]` with nothing after it is not a task item — the brackets are the
  // item's own text. The real task items sit in the same list, so this cannot
  // pass because the list failed to render.
  check(
    'a bare [ ] is text, not a checkbox',
    html.includes('<li>[ ]</li>') && html.includes('<span class="task-checkbox" data-line=')
  );
  check(
    'a blockquote holding nothing renders empty rather than vanishing',
    html.includes('<blockquote class="callout"></blockquote>')
  );
  check(
    'the sample offers a raw <video> and <audio> to the host',
    html.includes('<video src="../images/overview.png" controls></video>') &&
      html.includes('<audio src="../images/overview.png" controls></audio>')
  );

  // ---- what the sample says about math, read back ---------------------------
  check(
    'a LaTeX delimiter is not a delimiter here',
    html.includes('Inline (x^2) and display [y^2], but ')
  );
  check('an escaped dollar is a dollar, not a formula', html.includes('is a dollar and nothing more: $5 and $10, while'));
  check(
    'a display formula inside a quote or a list item stays in it',
    /<blockquote class="callout"><section><eqn/.test(html) &&
      /<li>\s*<p>A list item holding a display formula:<\/p>\s*<section><eqn/.test(html)
  );
  check(
    'extended syntax nests and stays inside its word',
    html.includes('log<sub>2</sub>n') &&
      html.includes('<s><strong>bold</strong> and <code>code</code> inside a strikethrough</s>')
  );

  // `script`, `form` and `iframe` are in this list on purpose. They are the
  // tags a document is not supposed to be able to *do* anything with, and a
  // mismatch in one of them is what renested the whole right-hand pane before —
  // so the check that they pair is the cheap half of the safety story, taken
  // here rather than in the BDD suite because it is a property of the sample
  // document rather than of a scenario.
  //
  // `open > 0` as well as `open === close`, which is the half that was missing.
  // A tag the sample never writes pairs perfectly at 0 and 0, so the check
  // passed without having looked at anything. Every tag in the list is now one
  // the sample really contains — `<video>` and `<audio>` joined it when the raw
  // HTML section grew them — and a renderer that quietly stopped emitting, say,
  // `<table>` fails here and says so by name. `<source>` is deliberately absent:
  // it is void, so an opening and a closing tag can never be counted for it, and
  // the resolver check above covers it instead.
  for (const tag of BALANCED_TAGS) {
    const open = (html.match(new RegExp(`<${tag}(\\s|>)`, 'g')) ?? []).length;
    const close = (html.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
    check(`tag balance <${tag}> (${open} open / ${close} close)`, open > 0 && open === close);
  }

  // ---- every sample, not just the kitchen sink -------------------------------
  // The other four files are what someone opens to try the extension, so the
  // invariants checked here are the ones a reader would notice if they broke:
  // the document renders at all, it has a title, every internal link goes
  // somewhere, and no element is left unclosed. The kitchen sink checks above
  // are about what that one document contains; these hold for all of them.
  const samplesDir = path.join(root, 'samples');
  const decodeAnchor = (raw: string): string => {
    try {
      return decodeURIComponent(raw);
    } catch {
      // A hand-written `%` that is not an escape is left as written, which is
      // also what the browser does with it.
      return raw;
    }
  };
  const walkTargets = (nodes: TocNode[]): string[] =>
    nodes.flatMap((n) => [n.target, ...walkTargets(n.children ?? [])]);
  for (const file of fs
    .readdirSync(samplesDir)
    .filter((f: string) => f.endsWith('.md'))
    .sort()) {
    const page = renderMarkdown(fs.readFileSync(path.join(samplesDir, file), 'utf8'));
    const ids = new Set([...page.html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] ?? ''));
    // A fragment is matched against ids after percent-decoding — that is what
    // makes `#café` reach `id="café"` even though markdown-it wrote the href as
    // `#caf%C3%A9`. Decoding here is the browser's rule, not a convenience.
    const dangling = [...page.html.matchAll(/href="#([^"]+)"/g)]
      .map((m) => decodeAnchor(m[1] ?? ''))
      .filter((anchor) => !ids.has(anchor));
    // Every entry the outline draws is a link, so a target that is not on the
    // page is a row that looks clickable and is not — for a heading, a table or
    // a diagram alike.
    const missingTargets = [...walkTargets(page.headings), ...page.tables.map((t) => t.target), ...page.diagrams.map((d) => d.target)].filter(
      (target) => !ids.has(target)
    );
    const unbalanced = BALANCED_TAGS.filter((tag) => {
      const open = (page.html.match(new RegExp(`<${tag}(\\s|>)`, 'g')) ?? []).length;
      const close = (page.html.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
      return open !== close;
    });
    check(`${file}: renders with a title`, /<h1 class="doc-title">/.test(page.html));
    check(`${file}: no anchor is left dangling`, dangling.length === 0);
    check(`${file}: every outline, table and diagram target is on the page`, missingTargets.length === 0);
    check(`${file}: every tag balances`, unbalanced.length === 0);
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
