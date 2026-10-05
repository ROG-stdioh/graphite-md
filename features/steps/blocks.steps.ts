// Steps for the block-level shape of a rendered document: lists, quotes and
// tables.
//
// The suite's content assertions were all about inline syntax, and the three
// things every Markdown document is mostly made of had none between them —
// `<em>` was asserted nowhere in the repo, `<ul>` and `<li>` nowhere, and the
// rule that turns every blockquote into a callout was guarded only by a
// tag-balance loop that passes at zero opens and zero closes. A renderer that
// emitted none of them satisfied every scenario there was.
//
// See document.steps.ts for why every step takes a world type argument and
// every parameter an annotation.
import type { DataTable } from '@cucumber/cucumber';
import type * as Html from '../lib/html';
import type { PreviewWorld } from '../support/world';

const { attrOf, byClass, byTag, childElements, classesOf, firstTag, parseHtml, textExcluding, textOf }: typeof Html =
  require('../lib/html.ts') as typeof Html;

// Annotated as well as cast — see document.steps.ts for why both are needed.
const assert: typeof import('assert') = require('assert') as typeof import('assert');
const { Then } = require('@cucumber/cucumber') as typeof import('@cucumber/cucumber');

// ---- lists ---------------------------------------------------------------

/**
 * The children a list item's own words are read past.
 *
 * A nested list's items are rows of their own in the table below rather than
 * part of this item's sentence, and the other four are blocks an item can hold
 * *instead of* saying something: an item holding a fence says its sentence in
 * the paragraph before the fence, and reading the fence in with it turns
 * "Run the migration:" into "Run the migration:npm run migrate".
 *
 * Paragraphs and inline elements are deliberately not in here. They are where
 * the sentence is — directly in a tight item, inside a `<p>` in a loose one —
 * and skipping them is what would make the column empty.
 */
const NOT_THE_ITEM_TEXT = new Set(['ul', 'ol', 'pre', 'blockquote', 'table', 'hr']);

/** What a list item says, as opposed to what is nested inside or attached to it. */
function labelOf(li: Html.El): string {
  return textExcluding(li, NOT_THE_ITEM_TEXT).trim();
}

/** One row of `the list reads:` — an item, the kind of list it is in, how deep. */
interface ListRow {
  kind: string;
  depth: number;
  item: string;
}

/**
 * Every list item in the document, in document order, each with the kind of
 * list it belongs to and how many lists enclose it.
 *
 * Depth is counted by walking, rather than read off the markup or asked of the
 * tree's parents, because that is the question the table is asking: an item one
 * level further in than it should be is the failure a three-deep sample list
 * exists to catch, and a renderer that flattened all three levels into one
 * `<ul>` would have every item at depth 0.
 */
function listRows(html: string): ListRow[] {
  const rows: ListRow[] = [];
  const enter = (node: Html.Root, depth: number): void => {
    for (const el of childElements(node)) {
      if (el.tagName === 'ul' || el.tagName === 'ol') {
        for (const li of childElements(el)) {
          if (li.tagName !== 'li') continue;
          rows.push({ kind: el.tagName, depth, item: labelOf(li) });
          enter(li, depth + 1);
        }
      } else {
        // A list inside anything else — a quote, a section body — is still the
        // document's list, at the depth it was written.
        enter(el, depth);
      }
    }
  };
  enter(parseHtml(html), 0);
  return rows;
}

// The whole shape of the document's lists in one table: which kind of list each
// item is in, how deeply nested it is, and what it says. Asserting all three at
// once is the point — a crossed `<ul>`/`<ol>`, a flattened nest and a dropped
// item are three different faults, and each of them moves exactly one column.
Then<PreviewWorld>('the list reads:', function (dataTable: DataTable) {
  const expected = dataTable.hashes().map((row) => ({
    kind: row.kind ?? '',
    depth: Number(row.depth),
    item: row.item ?? '',
  }));
  const actual = listRows(this.html);
  assert.deepStrictEqual(
    actual,
    expected,
    '\n  list mismatch\n  expected: ' + JSON.stringify(expected) +
      '\n  actual:   ' + JSON.stringify(actual)
  );
});

// CommonMark's tight/loose distinction, which a reader sees as the space
// between items. It is decided by whether the source left a blank line between
// them, and it is invisible to any assertion that only counts items.
Then<PreviewWorld>('the list is rendered loose', function () {
  const items = byTag(parseHtml(this.html), 'li');
  assert.ok(items.length > 0, 'the document rendered no list items at all, so this scenario proves nothing');
  for (const li of items) {
    const tags = childElements(li).map((el) => el.tagName);
    assert.ok(
      tags.includes('p'),
      `a loose list wraps every item in a paragraph; this item holds ${JSON.stringify(tags)}`
    );
  }
});

Then<PreviewWorld>('the list is rendered tight', function () {
  const items = byTag(parseHtml(this.html), 'li');
  assert.ok(items.length > 0, 'the document rendered no list items at all, so this scenario proves nothing');
  for (const li of items) {
    const tags = childElements(li).map((el) => el.tagName);
    assert.ok(
      !tags.includes('p'),
      `a tight list wraps no item in a paragraph; this item holds ${JSON.stringify(tags)}`
    );
  }
});

/** A list item, named by what it says rather than by where it is. */
function itemNamed(html: string, item: string): Html.El {
  const items = byTag(parseHtml(html), 'li');
  const found = items.find((li) => labelOf(li) === item);
  assert.ok(
    found,
    `no list item reads ${JSON.stringify(item)}; the items read ` +
      JSON.stringify(items.map(labelOf))
  );
  return found;
}

// An item can hold blocks rather than a sentence, and the block is the thing
// the reader came for: an item holding a fence is the common shape for a
// numbered set of commands, and a renderer that dropped the fence would leave
// the item's text behind and look fine.
Then<PreviewWorld>('the list item {string} holds a code block', function (item: string) {
  const li = itemNamed(this.html, item);
  const blocks = childElements(li).filter((el) => el.tagName === 'pre');
  assert.ok(
    blocks.length > 0,
    `the item ${JSON.stringify(item)} holds no code block; it holds ` +
      JSON.stringify(childElements(li).map((el) => el.tagName))
  );
});

Then<PreviewWorld>('the list item {string} holds a quote', function (item: string) {
  const li = itemNamed(this.html, item);
  const quotes = childElements(li).filter((el) => el.tagName === 'blockquote');
  assert.ok(
    quotes.length > 0,
    `the item ${JSON.stringify(item)} holds no quote; it holds ` +
      JSON.stringify(childElements(li).map((el) => el.tagName))
  );
});

// ---- quotes --------------------------------------------------------------

Then<PreviewWorld>('the preview shows {int} quotes', function (expected: number) {
  const found = byTag(parseHtml(this.html), 'blockquote').length;
  assert.strictEqual(found, expected, `expected ${expected} quotes, found ${found}`);
});

// The renderer rewrites every blockquote into a callout, and nothing asserted
// the rewrite itself. The check that stood in for it counted `<blockquote>`
// opens against closes — which is 0 against 0, and therefore a pass, for a
// document in which blockquotes stopped rendering at all. The count above is
// what stops that, and the list is asserted non-empty here so this step cannot
// be satisfied by there being no quotes to check.
Then<PreviewWorld>('every quote is rendered as a callout', function () {
  const found = byTag(parseHtml(this.html), 'blockquote');
  assert.ok(found.length > 0, 'the document rendered no quotes at all, so this scenario proves nothing');
  for (const quote of found) {
    assert.ok(
      classesOf(quote).includes('callout'),
      `a quote reached the page without the callout class: class=` +
        JSON.stringify(attrOf(quote, 'class') ?? '')
    );
  }
});

/** The tags whose text belongs to a *different* quote than the one being read. */
const NESTED_QUOTE: ReadonlySet<string> = new Set(['blockquote']);

// A quote holding another quote. The count above is satisfied by two quotes
// sitting side by side, and "every quote is a callout" is satisfied by both of
// them being top-level, so the nesting needs a claim of its own.
function expectNestedQuotes(this: PreviewWorld, expected: number): void {
  const quotes = byTag(parseHtml(this.html), 'blockquote');
  const nested = quotes.filter((quote) => byTag(quote, 'blockquote').length > 0);
  assert.strictEqual(
    nested.length,
    expected,
    `expected ${expected} quotes nested inside a quote, found ${nested.length}`
  );
}
Then<PreviewWorld>('the preview shows {int} quotes nested inside a quote', expectNestedQuotes);
Then<PreviewWorld>('the preview shows {int} quote nested inside a quote', expectNestedQuotes);

// What the quote says in its own voice, with any quote nested inside it left
// out. `the text ... is rendered inside the quote` cannot tell the two apart:
// the outer quote's `textOf` runs its own words and the inner quote's together,
// so "outer" being inside a quote is true whether the nesting is right or the
// renderer flattened it.
//
// Exactly one quote may be outermost, because the document this is written for
// has exactly one — with two, "the outermost quote" names nothing in particular
// and the assertion would be about whichever came first.
Then<PreviewWorld>('the outermost quote reads {string}', function (expected: string) {
  const quotes = byTag(parseHtml(this.html), 'blockquote');
  const outermost = quotes.filter(
    (quote) => !quotes.some((other) => other !== quote && byTag(other, 'blockquote').includes(quote))
  );
  assert.strictEqual(
    outermost.length,
    1,
    `expected exactly one outermost quote to read ${JSON.stringify(expected)} from; ` +
      `the page has ${outermost.length}`
  );
  const quote = outermost[0];
  assert.ok(quote, 'expected an outermost quote');
  const reads = textExcluding(quote, NESTED_QUOTE).trim();
  assert.strictEqual(
    reads,
    expected,
    `the outermost quote reads ${JSON.stringify(reads)}, expected ${JSON.stringify(expected)}`
  );
});

// The two halves of "the quote ends where it ends". A heading or a list inside
// a quote is where the rule that adds the class went wrong once: it split the
// open and close tokens across two sections, and the browser repaired the
// mismatched tags by renesting the rest of the page inside the quote. Nothing
// said so at the time, which is why both directions are asserted here.
Then<PreviewWorld>('the text {string} is rendered inside the quote', function (text: string) {
  const found = byTag(parseHtml(this.html), 'blockquote');
  assert.ok(found.length > 0, 'no quote reached the page at all');
  const held = found.map((quote) => textOf(quote));
  assert.ok(
    held.some((quote) => quote.includes(text)),
    `expected ${JSON.stringify(text)} inside a quote; the quotes hold ${JSON.stringify(held)}`
  );
});

Then<PreviewWorld>('the text {string} is rendered outside every quote', function (text: string) {
  const root = parseHtml(this.html);
  const found = byTag(root, 'blockquote');
  assert.ok(found.length > 0, 'no quote reached the page at all, so this scenario proves nothing');
  // The control: text that is on no part of the page satisfies "not inside a
  // quote" by being nowhere, which is the failure this is meant to catch.
  assert.ok(
    textOf(root).includes(text),
    `expected ${JSON.stringify(text)} on the page at all, and it is not`
  );
  for (const quote of found) {
    assert.ok(
      !textOf(quote).includes(text),
      `${JSON.stringify(text)} is inside a quote, and this scenario says it is not: ` +
        `the quote holds ${JSON.stringify(textOf(quote))}`
    );
  }
});

// ---- tables --------------------------------------------------------------

Then<PreviewWorld>('the preview shows a table with {int} columns and {int} rows', function (
  columns: number,
  rows: number
) {
  const root = parseHtml(this.html);
  const table = byClass(root, 'md-table')[0];
  assert.ok(
    table,
    'no table reached the page at all; the page holds ' +
      JSON.stringify(byTag(root, 'table').map((el) => attrOf(el, 'class') ?? ''))
  );
  const headers = byTag(table, 'th');
  const bodyRows = byTag(table, 'tbody').flatMap((body) => byTag(body, 'tr'));
  assert.strictEqual(
    headers.length,
    columns,
    `expected ${columns} header cells, found ${headers.length}`
  );
  assert.strictEqual(bodyRows.length, rows, `expected ${rows} body rows, found ${bodyRows.length}`);
});

/**
 * The `text-align` a cell carries in its own `style` attribute, or "none".
 *
 * Read out of the attribute rather than computed, because there is no browser
 * here to compute it with. The attribute is also the whole of the claim: the
 * stylesheet has no rule for a table cell's alignment — it cannot, the
 * alignment is the author's and comes from the source — so a cell that does not
 * carry it is a cell that is not aligned.
 */
function alignmentOf(cell: Html.El): string {
  const style = attrOf(cell, 'style') ?? '';
  return /(?:^|;)\s*text-align\s*:\s*([a-z]+)/i.exec(style)?.[1]?.toLowerCase() ?? 'none';
}

// The four alignments a Markdown table can write, on the header and the body
// cell of the same column — an alignment applied to one and not the other reads
// as a column that straightens itself out below its own heading.
Then<PreviewWorld>('the table aligns its columns:', function (dataTable: DataTable) {
  const expected = dataTable.hashes().map((row) => ({
    column: row.column ?? '',
    align: row.align ?? '',
  }));

  const root = parseHtml(this.html);
  const table = firstTag(root, 'table');
  assert.ok(table, 'the document rendered no table at all, so this scenario proves nothing');

  const head = firstTag(table, 'thead');
  const cells = head ? byTag(head, 'th') : [];
  assert.ok(cells.length > 0, 'the table has no header row to read an alignment from');

  const actual = cells.map((cell) => ({
    column: textOf(cell).trim(),
    align: alignmentOf(cell),
  }));

  assert.deepStrictEqual(
    actual,
    expected,
    '\n  alignment mismatch\n  expected: ' + JSON.stringify(expected) +
      '\n  actual:   ' + JSON.stringify(actual)
  );

  // And the body, which is the half a rule applied at `table_open` time would
  // miss: markdown-it decides the alignment per column while parsing, and the
  // body cells are rendered by a different rule from the header's.
  for (const body of byTag(table, 'tbody')) {
    for (const row of byTag(body, 'tr')) {
      for (const [i, cell] of childElements(row).entries()) {
        const column = expected[i];
        if (!column) continue;
        assert.strictEqual(
          alignmentOf(cell),
          column.align,
          `the body cell under ${JSON.stringify(column.column)} is aligned ` +
            `${JSON.stringify(alignmentOf(cell))} while its heading is ` +
            JSON.stringify(column.align)
        );
      }
    }
  }
});
