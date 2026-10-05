# graphite.md

A custom Markdown preview for VS Code: collapsible sections, a foldable
git-graph style outline in the right-hand pane (Content / Tables / Diagrams),
math, Mermaid diagrams, checklists, and a dark Claude-branded theme.

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
Side** from the Command Palette (or `Ctrl+G S`). `Ctrl+G P` opens the preview
in the group you are in and `Ctrl+G O` folds the outline pane; the three
bindings are a chord of graphite.md's own because `Ctrl+K V` belongs to VS
Code's built-in Markdown preview.

`npm run watch` rebuilds both bundles on save — the extension host and the
webview. Reload the Extension Development Host window (`Cmd+R` / `Ctrl+R`) to
pick up host changes; a webview change needs only the preview panel closed and
reopened (or a keystroke in the markdown file, which re-renders the HTML).

The webview lives in `src/webview/main.ts` and is bundled to
`media/preview.js`, which is generated output: gitignored, never edited in
place, and rebuilt by `npm run build`, by `npm run watch`, and by the check
script below. `media/preview.css` is still hand-written and still needs no
rebuild.

## Testing

Three layers, and they answer different questions: the **renderer** (named
scenarios, and a corpus of whole documents compared byte for byte), the
**editor seam** (the extension inside a real VS Code), and the **live page**
(driven over the debugger, where there is a real layout to measure). The first
runs in Node in about a second; the other two both need an editor, so they
share a CI job of their own.

```bash
npm run check && npm run test:bdd   # the renderer: scenarios, corpus, checks
npm run test:integration            # the editor seam, and the live page inside it
```

`npm run typecheck`, `npm run lint` and `npm run knip` are the static gates.
CI (`.github/workflows/ci.yml`) runs all of it on every pull request against
`dev` **and** `main`, in two jobs: **verify** — the static gates, the build,
`check`, `check:media`, `check:package` and the BDD suite — and **integration**,
which downloads and launches a pinned VS Code. Both branches are gated because
the pull request that actually reaches users is the `dev` → `main` release one.

**The BDD suite** describes the preview's behaviour in the product's own
vocabulary, so it also serves as a statement of what the extension promises:

```bash
npm run test:bdd   # 189 scenarios in features/, ~1s
```

Scenarios live in `features/*.feature`, one file per area, with steps in
`features/steps/` and the shared world in `features/support/world.ts`. The
world bundles `src/markdown.ts` with esbuild on every run and drives the real
module — not a mock, and never a cached bundle, so the suite cannot pass
against a stale version of the source. Adding a scenario usually means adding
a step; a step that matches nothing fails the run rather than being silently
skipped (`strict: true` in `cucumber.js`).

Content assertions go through `features/lib/html.ts`, which parses the output
with parse5 rather than matching patterns against the string. That is not
tidiness: a string cannot be asked whether one element sits inside another,
and the scenarios that matched raw text passed for the wrong reason — the
superscript and subscript scenarios both asserted on a `2`, so exchanging the
two plugins satisfied both and the one thing they existed to pin went
unpinned. parse5 specifically, because raw HTML renders, so the question is
what a *browser* makes of the markup — a lenient parser would agree with the
renderer instead of with the reader. It is a devDependency and never ships.

**The golden corpus** pins the whole output of the renderer, not one behaviour
at a time:

```bash
npm run check:golden              # compare samples/ against samples/golden/
node scripts/golden-check.ts --update   # regenerate after an intended change
```

A scenario can only catch a change to something somebody thought to write
down; a golden file asserts every byte, so a rule firing one element earlier
or an attribute appearing lands as a visible diff instead of a silent pass.
Generated, never hand-written, and writing takes an explicit `--update` — the
diff is meant to be read in the pull request. The trap is circularity (a bug
present at generation time is frozen as the specification), which is why the
corpus was generated after the conformance fixes rather than before them.

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

And it covers the resolvers in `src/settings.ts`. They live outside
`extension.ts` for a reason worth keeping: `extension.ts` cannot be required
outside a running VS Code, so a coercion left inside it is untestable in every
layer that runs in seconds, and the input it has to survive — a hand-edited
`"contentWidth": "80"` arriving as a string — is exactly the kind that goes
wrong quietly.

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

**The integration suite** is the only layer that runs inside a real editor:

```bash
npm run test:integration   # builds, compiles test/, downloads the editor
```

`test/suite/extension.test.ts` covers the extension host: activation, every
command the manifest contributes, the panel lifecycle, opening to the side, and
that a second open reveals the panel rather than adding another. It runs
through `@vscode/test-cli` pinned to the floor of `engines.vscode` rather than
`stable` — the oldest editor the Marketplace still offers the extension to is
the one that breaks first.

`test/suite/webview.test.ts` goes further and drives the live page over the
Chrome DevTools Protocol (`test/suite/cdp.ts`): tick a checkbox and read the
file, fold the outline and measure the pane, wait for mermaid and look at the
drawing. It is the only layer that can see a layout at all — `graph-check.ts`
writes geometry into a double by hand, and a webview's contents are invisible
to the extension host API by design. A layout bug is exactly the class this
layer exists for.

## Profiling

Two profilers, because the cost is split across two processes and only one of
them can be measured from Node:

```bash
npm run profile          # the host pipeline, measured from Node
npm run profile:webview  # the page the webview loads, measured in a headless Chromium
```

`npm run profile` measures what the extension host does per render
(`renderMarkdown`, `buildWebviewHtml`) and does the arithmetic on the media the
webview is handed. `npm run profile:webview` is the other half, and the reason
it drives a real browser rather than reasoning about one: the question the perf
work turns on — whether a reload re-pays mermaid's parse — is a question about
Chromium, and cannot be answered by reading the source or from Node. It builds
the real page, serves it over HTTP so the CSP's scheme sources behave as they do
in a webview, and navigates three times, because a second load can still be
warming and a number that is still falling looks like a number a user lives
with.

The instrumentation lives in `src/shared/perf.ts`, gated on `__PROFILE__` —
esbuild substitutes the identifier textually, so an instrumented bundle carries
the marks and a release bundle carries `if (false)` with the minifier dropping
the bodies. `npm run build:profile` and `npm run watch:profile` turn it on, and
the **Run graphite.md (profiling)** launch configuration exists because F5's
default preLaunchTask would otherwise rebuild with the flag off and quietly
overwrite an instrumented tree. `npm run check:package` greps the packaged
`media/preview.js` for the marker, because "the minifier should have removed it"
is a belief and a grep is a fact.

**It is a developer's tool, and it is deliberately not wired to the Output
Channel.** The profiler writes marks a developer reads in the webview's own
DevTools; the `graphite.md` channel is what a *user* reads when the preview
misbehaves. Sharing a code path would mean shipping profiler plumbing to people
who never asked for it — which is the exact category of thing the profiler was
built to find.

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
  lifecycle, the settings.json <-> webview two-way sync (content width,
  checklist edits), and render scheduling: renders are debounced, and a panel
  that is not visible skips its render and catches up when it becomes visible
  again.
- **`src/markdown.ts`** — markdown-it configured to:
  - pass raw HTML through as markup (`html: true`), matching VS Code's own
    preview. The boundary is the page's Content-Security-Policy, not this
    option — see `src/webviewHtml.ts` for why the decision lives there
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
  - show a leading YAML front matter block as a key/value table, the way VS
    Code's own preview does, with a parse failure reported as an error block
    rather than as half a table
  - collect headings/tables/diagrams into `TocNode[]` arrays, handed to the
    webview as `window.__PREVIEW_DATA__` so the client never needs to
    re-parse the DOM to build the outline
- **`src/webviewHtml.ts`** — the page the webview loads, as a string. Pure in
  the same sense `markdown.ts` is: no `vscode` import, no filesystem access of
  its own, so `scripts/media-version-check.ts` can build the real page and
  assert on it without an editor. Two things the page cannot know — where the
  media directory is, and how a path becomes a loadable URL — arrive as
  arguments. It is also where the Mermaid `<script>` is gated on the document
  actually having a diagram, which is worth reading before changing: the tag's
  *absence* is ambiguous between "no diagrams" and "diagrams, but the file
  failed to load", and the page is told which is which rather than guessing.
- **`src/mediaVersion.ts`** — the content-derived version in each media URL,
  which is what stops an upgrading user running the previous release's cached
  bundle. Memoised per file on size and timestamp.
- **`src/sourceRef.ts`** — turning an image `src` written in a document into a
  URL the webview may load, or a refusal with a reason. Separate from
  `extension.ts` for the same reason `settings.ts` is: it is a pure decision
  over its inputs, and the inputs it has to survive are the awkward ones.
- **`src/taskMarker.ts`** — finding the `- [ ]` on a given source line, so a
  checkbox click rewrites the box rather than whatever is near it. Shared by
  the renderer, which tags a box with its line, and the host, which writes the
  edit — so the two cannot disagree about which line a box came from.
- **`src/logger.ts`** — where the extension's own diagnostics go. The sink is
  settable rather than constructed here, because the renderer must be loadable
  without an editor: `activate()` points it at the `graphite.md` Output
  Channel, and outside VS Code it stays on `console`. Nothing in the file
  imports anything, which is what lets the same code run in the host, in the
  check scripts and in the BDD suite.
- **`src/settings.ts`** — reading and coercing the `graphiteMd.*`
  configuration. Separate from `extension.ts` because that module cannot be
  required outside a running VS Code, so anything left inside it stays out of
  reach of every layer that runs in seconds.
- **`src/shared/protocol.ts`** — the host <-> webview message contract, plus the
  runtime guards for all three inbound channels (`isWebviewToHost`,
  `isHostToWebview`, `isPreviewData`). Types are erased at build time, so the
  guards are what actually hold the boundary at runtime.
- **`src/webview/main.ts`** — the preview's client side, bundled to
  `media/preview.js`: the git-graph SVG outline,
  soft-scroll navigation, custom overlay scrollbars, the accordion
  ("On this page" -> Content / Tables / Diagrams, at most one open), the
  outline's fold (its state rides in `vscode.setState` beside the scroll
  position, which is why a re-render does not spring the pane back open), and
  the halftone callout background (real SVG circles sized from the element's
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

Four, all read from `graphiteMd.*`. `package.json` holds the description a user
reads in the Settings UI, so change it there and here together.

| Setting | Default | What it does |
|---|---|---|
| `graphiteMd.contentWidth` | `60` | Percentage (40–100) of the available preview width used for the reading column. |
| `graphiteMd.remoteImages` | `false` | Allows `https://` images. A preview is a local reading surface, and turning this on lets any document you open make requests to a server its author chose. |
| `graphiteMd.typographer` | `true` | Straight quotes become curly, `--` an en dash, `...` an ellipsis. Code is never touched. VS Code's own preview has the same option with it **off**, so this is the one place the two previews disagree by default. |
| `graphiteMd.animation` | `true` | Animates the outline's fold. Off makes it instant; the system's "reduce motion" setting always makes it instant. |

An open preview picks a change up live, through the single
`onDidChangeConfiguration` listener in `src/extension.ts`. Its three branches
deliberately take different paths. Width and animation message the webview,
because a re-render would throw away the scroll position, the fold state and
the drawn diagram to change a number that affects none of them. Remote images
cannot: the permission lives in the page's CSP, which is part of the document,
so answering it any other way means writing a new one — and losing the scroll
position, which is the honest cost of changing what the page may load.
Typographer has no branch: it changes rendered output, and the next render (any
edit) picks it up.

Each of the four has a resolver in `src/settings.ts` rather than an inline
coercion in `extension.ts`, because that module cannot be required outside a
running VS Code — a coercion left inside it is out of reach of every layer that
runs in seconds, and the input it has to survive is exactly the kind that goes
wrong quietly: a hand-edited `"contentWidth": "80"` arrives as a string.

## Where this preview differs from VS Code's

Read from VS Code's own source (`release/1.140`, the built-in
`markdown-language-features`), not from memory. **Name the version whenever you
assert "VS Code does X"** — front matter's table rendering is newer than 1.100,
mermaid only became built in at 1.121, and anything here will rot the same way.

| Behaviour | VS Code's preview | graphite.md | Note |
|---|---|---|---|
| Raw HTML | `html: true` | `html: true` | Same; the boundary is the page's CSP on both sides |
| Bare-filename linkify | fuzzy links off | fuzzy links off, custom rule | Same outcome, arrived at independently |
| Heading anchors | github-slugger: Unicode kept, `-1`/`-2` for duplicates | own slugify: Unicode kept, `-1`/`-2` for duplicates, plus a `section` fallback | Same rule; the fallback is ours, because an empty id is a heading nothing can link to |
| Typographer | `markdown.preview.typographer`, **off** | `graphiteMd.typographer`, **on** | Deliberate; the two options are named alike so a team can align them |
| Front matter | rendered as a table | rendered as a table | Same |
| Remote images | `img-src https:` — the network is allowed | off by default | Deliberate upgrade; the setting is the opt-in |
| Task lists | none — `- [ ]` stays literal text | clickable, writes back to the file | We exceed; no counterpart exists |
| Footnotes, `^sup^`, `~sub~`, `++ins++`, `==mark==` | none | five plugins | We exceed; no counterpart exists |
| Math | KaTeX, via `markdown.math.enabled` | KaTeX via `markdown-it-texmath` | Same capability, different plugin — the delimiter rules are ours to test, not to assume |
| Mermaid | built in since 1.121 | vendored, and its 3.18 MB loaded only when a document has a diagram | Same capability; ours is gated |
| Scroll sync | `data-line` on every token | not implemented | Declined ([#9](https://github.com/ROG-stdioh/graphite-md/issues/9)) — see `ROADMAP.md` |
| `markdown.styles` | user stylesheets applied to the page | none | A real gap, named in `ROADMAP.md` |

The last row is the one place the two previews disagree because something is
*missing* rather than because we chose differently. Everything above it is a
decision, and this table is here so the next person to notice one of them finds
the reason instead of "fixing" it.

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
- **The first render in a window can block the extension host for seconds**, and
  the cause is measured rather than suspected. The `stages` line in the Output
  Channel splits a render into `pre` / `text` / `markdown` / `html` / `webview`;
  on a reported ~4.5 s first render, 4508 ms of the total was `html` — the
  `buildWebviewHtml` span, whose only I/O is `contentVersion` reading and
  hashing the media files, 3.18 MB of that being Mermaid. The same calls measure
  2.2 ms of actual CPU on this machine, so the time is I/O wait on a cold file
  cache rather than computation, and it is paid once per extension host rather
  than once per render. The Mermaid gate in `webviewHtml.ts` already removes it
  for a document with no diagram, because the file is then never named and so
  never read at all; what remains is the first render of a document that has
  one. A manifest of media versions written at build time would remove the read
  entirely — the render path would look a version up instead of deriving it.
  ([#25](https://github.com/ROG-stdioh/graphite-md/issues/25))
- The typographer setting is read at render time, so a change to it lands on
  the next render rather than the moment you flip it. Width, animation and
  remote images all take effect immediately.
