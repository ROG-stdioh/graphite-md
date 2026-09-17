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
`features/steps/` and the shared world in `features/support/world.ts`. The
world bundles `src/markdown.ts` with esbuild on every run and drives the real
module — not a mock, and never a cached bundle, so the suite cannot pass
against a stale version of the source. Adding a scenario usually means adding
a step; a step that matches nothing fails the run rather than being silently
skipped (`strict: true` in `cucumber.js`).

**The smoke checks** cover the parts a live preview is slowest to catch
regressions in, at a level below the prose:

```bash
node scripts/render-check.ts   # markdown pipeline over samples/kitchen-sink.md
node scripts/graph-check.ts    # webview: graph layout, host messages, accordion, scroll
```

`graph-check.ts` rebuilds the webview bundle first, through the same options
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

**The media check** asserts that every file the preview page loads is requested
at a URL carrying a version derived from that file's own contents:

```bash
npm run build && npm run check:media   # needs the build: media/vendor/ is copied
```

VS Code's webview serves a cached copy of an asset across panel reopens, so
without a version an upgrading user keeps running the previous release's code —
silently, and for exactly the people who upgraded. The version is derived at
runtime from the file on disk (`src/mediaVersion.ts`), which is what makes it
impossible to forget; the check is what proves each URL actually carries one. It
replaced a `MEDIA_VERSION` constant in the HTML template that was bumped by
hand, and missed, once per release that touched a media file.

**The packaging check** asks vsce which files it would actually put in the
.vsix, then fails on any that is not explicitly expected:

```bash
npm run build && npm run check:package   # needs the build: media/ is generated
```

It exists because `.vscodeignore` is a denylist, and denylists rot: four dev
files (`tsconfig.base.json`, `knip.jsonc`, `eslint.config.ts`,
`.github/workflows/ci.yml`) had been shipping unnoticed. Nothing failed — they
were just in the .vsix. Adding runtime content now means editing the `ALLOWED`
list in `scripts/package-check.ts`, which is the point: the question gets asked
when the file is added rather than whenever someone next runs `vsce ls`.

Two things worth not rediscovering. The check drives vsce's `listFiles` API
rather than parsing `vsce ls` output, so it reads the same filter vsce will
apply without depending on CLI formatting. And it does **not** use the `files`
field in `package.json`: while a `.vscodeignore` exists vsce never reads that
field at all — `collectFiles` only consults it when the `.vscodeignore` read
fails with `ENOENT` — so a `files` allowlist here would be silently dead, with
`vsce ls` still printing a clean success.

## The tooling is TypeScript too

Everything outside `src/` — the build script, the four check scripts, the BDD
suite and `eslint.config.ts` — is TypeScript, checked by `tsconfig.node.json`.
A third program rather than part of the others because it runs in Node: no
`vscode` module, no DOM, and its own file list.

What these files are *not* is ESM. Node loads them directly — `node
scripts/graph-check.ts`, cucumber's glob over `features/**`, the `require.main`
guard in `esbuild.ts` — and Node 24 strips the types as it loads them. A `.ts`
file using import syntax, in a package with no `"type"` field, makes Node emit
`MODULE_TYPELESS_PACKAGE_JSON` and reparse it as ESM on every single run, and it
would take `module.exports` and `require.main` with it. So they are CommonJS,
and `@typescript-eslint/no-require-imports` is switched off for this program
alone — with the reason written where the rule is switched off, in
`eslint.config.ts`, rather than at the top level where it would also stop
guarding `src/`.

Two things worth knowing before editing them:

- A `require()` hands back `any`, so each one reattaches its module's type:
  `const esbuild = require('esbuild') as typeof import('esbuild')`. Where the
  module has real `export` syntax that is the whole fix. Where it publishes
  itself with `module.exports = { ... }`, TypeScript cannot infer a module shape
  from that assignment at all, and the type has to be written out at the call
  site — `as { buildWebview: () => void }`.
- `features/support/world.ts` ends with a type-only `export type { ... }`. That
  is not a stray line: it is how a file that is CommonJS at runtime publishes
  types the step files can consume as `import type`. Both `import type` and
  `export type` are erased before Node decides a file's module format, so the
  file stays CommonJS and gains typed consumers.

`cucumber.js` is the one JavaScript file left, and it has to be: cucumber
discovers its configuration from a fixed list of filenames, and `cucumber.ts` is
not on it — renaming it would mean the suite ran with no configuration at all,
`strict` included. `eslint.config.ts` is loaded through `jiti`, which ESLint
requires for a TypeScript config file; that is why `jiti` is a declared
devDependency rather than something borrowed from another package's tree.

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
- **`src/settings.ts`** — reading and coercing the `graphiteMd.*`
  configuration. Separate from `extension.ts` because that module cannot be
  required outside a running VS Code, so anything left inside it is untestable
  until there are integration tests.
- **`src/shared/protocol.ts`** — the host <-> webview message contract, plus the
  runtime guards for all three inbound channels (`isWebviewToHost`,
  `isHostToWebview`, `isPreviewData`). Types are erased at build time, so the
  guards are what actually hold the boundary at runtime.
- **`src/webview/main.ts`** — the preview's client side, bundled to
  `media/preview.js`: the git-graph SVG outline,
  soft-scroll navigation, custom overlay scrollbars, the accordion
  ("On this page" -> Content / Tables / Diagrams, at most one open), and the
  halftone callout background (real SVG circles sized from the element's
  actual `clientWidth`/`clientHeight` via `ResizeObserver` — never a
  stretched raster).
- **`tsconfig.json` / `src/webview/tsconfig.json` / `tsconfig.node.json`** —
  three checked programs with deliberately different environments: the host gets
  node types and no DOM, the webview gets DOM and no node types, and neither can
  reach into the other; the tooling gets node types and its own file list. Each
  names what it contains rather than what it skips, so a new script lands in the
  tooling program instead of being swept into whichever config happens to be
  nearest. `tsconfig.base.json` holds what they share.
  `src/shared/protocol.ts` is compiled by both sides of the message boundary, so
  the contract cannot drift without one of them failing to build. esbuild does
  all the emitting; every program is a pure checker, so `npm run typecheck` is
  the thing that makes `strict` mean anything.
- **`scripts/copy-assets.ts`** — copies just the KaTeX CSS/fonts and the
  Mermaid bundle out of `node_modules` into `media/vendor/`, so the webview
  never reaches out to a CDN at runtime (which its Content-Security-Policy
  blocks anyway). The copied KaTeX CSS is not byte-identical to the one in
  `node_modules`: its 60 `url(fonts/…)` references get a version baked in, since
  a stylesheet's query string does not reach the URLs written inside it, and
  that is the only way those files can be cache-busted at all.

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
  `src/webview/main.ts`.)
- The media version is memoised per file on size and timestamp, so a 3.2 MB
  mermaid bundle is not re-hashed on every keystroke. A rewrite that changed
  neither — the same length, inside one filesystem timestamp tick — would go
  unnoticed until the next one. Nothing in the build does that: two builds
  producing identical bytes want the same version anyway, and different bytes
  differing only in length is not a thing an edit does.
- **No integration tests.** Everything above runs outside VS Code: the smoke
  checks drive the built webview against a hand-rolled DOM double, and the BDD
  suite drives the markdown pipeline directly. Nothing exercises activation,
  command registration or the webview lifecycle inside a real editor, so a
  regression in the host's wiring is caught by the manual F5 pass or not at
  all. `@vscode/test-cli` is the intended home for that.
