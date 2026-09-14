# graphite.md

A custom Markdown preview for VS Code: collapsible sections, a git-graph
style outline in the right-hand pane (Content / Tables / Diagrams), math,
Mermaid diagrams, checklists, and a dark Claude-branded theme.

## Setup

```bash
npm install
npm run build
```

Then press **F5** in VS Code (with this folder open as the workspace root)
to launch an Extension Development Host with graphite.md loaded. Open any
`.md` file in that host window and run **graphite.md: Open Preview to the
Side** from the Command Palette (or `Ctrl+K V` / `Cmd+K V`).

`npm run watch` rebuilds the extension host bundle on save; reload the
Extension Development Host window (`Cmd+R` / `Ctrl+R`) to pick up changes.
Changes to `media/preview.js` or `media/preview.css` don't need a rebuild —
just close and reopen the preview panel (or edit the markdown file, which
re-renders the webview's HTML anyway).

Two layers, and they answer different questions. Run both with
`npm run check && npm run test:bdd`.

**The BDD suite** describes the preview's behaviour in the product's own
vocabulary, so it also serves as a statement of what the extension promises:

```bash
npm run test:bdd   # Gherkin scenarios in features/, ~1s
```

Scenarios live in `features/*.feature`, one file per area, with steps in
`features/steps/` and the shared world in `features/support/world.js`. The
world bundles `src/markdown.ts` with esbuild on every run and drives the real
module — not a mock, and never a cached bundle, so the suite cannot pass
against a stale version of the source. Adding a scenario usually means adding
a step; a step that matches nothing fails the run rather than being silently
skipped (`strict: true` in `cucumber.js`).

**The smoke checks** cover the parts a live preview is slowest to catch
regressions in, at a level below the prose:

```bash
node scripts/render-check.js   # markdown pipeline over samples/kitchen-sink.md
node scripts/graph-check.js    # outline graph edge layout via a DOM stub
```

## Why no "Custom CSS and JS Loader"?

Not needed. That extension patches VS Code's own `workbench.html` to inject
styles into the *editor chrome itself* — a hack around the fact that VS
Code doesn't support customizing its own UI that way, and one that breaks on
every VS Code update. We're not touching the workbench at all. We create our
own `WebviewPanel`, which is a fully supported, first-party API — the CSS
and JS living in `media/` are just... graphite.md's own webview content, no
different from a web page loading its own stylesheet.

## Architecture

- **`src/extension.ts`** — activation, command registration, webview
  lifecycle, and the settings.json <-> webview two-way sync (content width,
  checklist edits).
- **`src/markdown.ts`** — markdown-it configured to:
  - group `##`/`###`/etc. into nested, collapsible
    `.section` / `.section-head` / `.section-body` divs
  - render math server-side via KaTeX (`markdown-it-texmath`) — more
    robust than the client-side auto-render approach used in the earlier
    HTML mockup, since it can't fail to run or race with page load
  - turn ` ```mermaid ` fences into `<div class="mermaid">` blocks for the
    client-side Mermaid renderer to pick up (Mermaid needs a real browser
    DOM to lay diagrams out, so unlike math it can't reasonably move
    server-side)
  - syntax-highlight other fenced code via highlight.js (markdown-it's
    `highlight` option); unknown languages fall back to plain escaping
  - render superscript/subscript/underline/mark/footnotes via the standard
    markdown-it plugins, with footnote definitions hoisted out of the
    section tree into a document footer
  - tag blockquotes with `.callout` (the halftone-dissolve style)
  - detect `- [ ]` / `- [x]` checklist items and inject a clickable
    checkbox tagged with its source line number
  - collect headings/tables/diagrams into `TocNode[]` arrays, handed to the
    webview as `window.__PREVIEW_DATA__` so the client never needs to
    re-parse the DOM to build the outline
- **`media/preview.css` / `media/preview.js`** — carried over from the
  interactive HTML mockup almost unchanged: the git-graph SVG outline,
  soft-scroll navigation, custom overlay scrollbars, the accordion
  ("On this page" -> Content / Tables / Diagrams, at most one open), and the
  halftone callout background (real SVG circles sized from the element's
  actual `clientWidth`/`clientHeight` via `ResizeObserver` — never a
  stretched raster).
- **`scripts/copy-assets.js`** — copies just the KaTeX CSS/fonts and the
  Mermaid bundle out of `node_modules` into `media/vendor/`, so the webview
  never reaches out to a CDN at runtime (which its Content-Security-Policy
  blocks anyway).

## Settings

```json
"graphiteMd.contentWidth": 60
```

Percentage (40-100) of the available preview width used for the reading
column. Editable in `settings.json`; the preview picks the change up live.

## Known gaps / next steps

- **Merged-cell tables** (the earlier mockup's `rowspan` example) are
  intentionally not implemented — a custom fenced syntax (tentatively
  `mgTable`) still needs designing so it's easy for both humans and LLMs to
  write without dropping into raw HTML. Deferred on purpose.
- Scroll sync from the editor cursor into the preview (and back) isn't wired
  up yet — right now the preview re-renders on every edit but doesn't
  auto-scroll to follow the cursor. (Re-renders do preserve the preview's
  scroll position — see the webview-state scroll restore in
  `media/preview.js`.)
- `publisher` in `package.json` is a placeholder — set it to your real
  Marketplace publisher id before packaging with `vsce package`.
