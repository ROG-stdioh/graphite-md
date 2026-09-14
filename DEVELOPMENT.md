# graphite.md

A custom Markdown preview for VS Code: collapsible sections, a git-graph
style outline in the right-hand pane (Content / Tables / Diagrams), math,
Mermaid diagrams, checklists, and a dark Claude-branded theme.

## Setup

Node 24 or newer. The check scripts require `src/shared/protocol.ts`
directly and rely on Node stripping the types itself, which 24 does without
a flag.

```bash
npm install
npm run build
```

Then press **F5** in VS Code (with this folder open as the workspace root)
to launch an Extension Development Host with graphite.md loaded. Open any
`.md` file in that host window and run **graphite.md: Open Preview to the
Side** from the Command Palette (or `Ctrl+K V` / `Cmd+K V`).

`npm run watch` rebuilds both bundles on save — the extension host and the
webview. Reload the Extension Development Host window (`Cmd+R` / `Ctrl+R`) to
pick up host changes; a webview change needs only the preview panel closed and
reopened (or a keystroke in the markdown file, which re-renders the HTML).

The webview lives in `src/webview/main.ts` and is bundled to
`media/preview.js`, which is generated output: gitignored, never edited in
place, and rebuilt by `npm run build`, by `npm run watch`, and by the check
script below. `media/preview.css` is still hand-written and still needs no
rebuild.

Two layers, and they answer different questions. Run both with
`npm run check && npm run test:bdd`. `npm run typecheck`, `npm run lint` and
`npm run knip` are the static gates, and `npm run check:package` guards the
.vsix; all six run on every PR against `dev` and `main`
(`.github/workflows/ci.yml`).

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
node scripts/graph-check.js    # webview: graph layout, host messages, accordion, scroll
```

`graph-check.js` rebuilds the webview bundle first, through the same options
object the real build uses, so the bytes it exercises are the bytes that ship
rather than whatever the last build left on disk. It then runs that bundle
against a hand-rolled DOM double rather than a real DOM. That is deliberate:
the webview's logic *is* geometry — `offsetTop`, `clientHeight`,
`getBoundingClientRect` — and jsdom implements no layout engine, so every rect
comes back `0` and the graph assertions would be vacuous. The double lets a
test set geometry explicitly.

It covers the outline graph's edge layout, the messages the webview sends the
host (`toggleTask`, `openLink`), the one-view-open accordion, the reading-width
message, and the scroll position surviving a re-render. The last four are the
host contract, which nothing checked before.

It also runs the host's `isWebviewToHost` guard over the payloads the webview
actually posted, not over examples written to match it. The host drops any
message that fails that guard and returns without a word, so if the guard and
the webview ever disagree the messages vanish and every other assertion here
still passes. The guard is separately shown rejecting malformed input, since a
guard that accepts everything would satisfy the first check on its own.

And it covers `resolveContentWidth` from `src/settings.ts`. That one lives
outside `extension.ts` for a reason worth keeping: `extension.ts` cannot be
required outside a running VS Code, so a setting coercion left inside it is
untestable until there are integration tests, and the input it has to survive —
a hand-edited `"contentWidth": "80"` arriving as a string — is exactly the kind
that goes wrong quietly.

**The packaging check** asks vsce which files it would actually put in the
.vsix, then fails on any that is not explicitly expected:

```bash
npm run build && npm run check:package   # needs the build: media/ is generated
```

It exists because `.vscodeignore` is a denylist, and denylists rot: four dev
files (`tsconfig.base.json`, `knip.jsonc`, `eslint.config.js`,
`.github/workflows/ci.yml`) had been shipping unnoticed. Nothing failed — they
were just in the .vsix. Adding runtime content now means editing the `ALLOWED`
list in `scripts/package-check.js`, which is the point: the question gets asked
when the file is added rather than whenever someone next runs `vsce ls`.

Two things worth not rediscovering. The check drives vsce's `listFiles` API
rather than parsing `vsce ls` output, so it reads the same filter vsce will
apply without depending on CLI formatting. And it does **not** use the `files`
field in `package.json`: while a `.vscodeignore` exists vsce never reads that
field at all — `collectFiles` only consults it when the `.vscodeignore` read
fails with `ENOENT` — so a `files` allowlist here would be silently dead, with
`vsce ls` still printing a clean success.

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
- **`src/webview/main.ts`** — the preview's client side, bundled to
  `media/preview.js`: the git-graph SVG outline,
  soft-scroll navigation, custom overlay scrollbars, the accordion
  ("On this page" -> Content / Tables / Diagrams, at most one open), and the
  halftone callout background (real SVG circles sized from the element's
  actual `clientWidth`/`clientHeight` via `ResizeObserver` — never a
  stretched raster).
- **`tsconfig.json` / `src/webview/tsconfig.json`** — two checked programs with
  deliberately different environments: the host gets node types and no DOM, the
  webview gets DOM and no node types, and neither can reach into the other.
  `tsconfig.base.json` holds what they share. `src/shared/protocol.ts` is
  compiled by both, so the message contract cannot drift between the two sides
  without one of them failing to build. esbuild does all the emitting; every
  program is a pure checker, so `npm run typecheck` is the thing that makes
  `strict` mean anything.
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
