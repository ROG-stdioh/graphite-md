# Changelog

All notable changes to graphite.md are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-10-01

Raw HTML, at last — the one place the preview disagreed with VS Code's own and
with every other Markdown renderer. Alongside it, the preview stopped rebuilding
itself from scratch on every keystroke, and there is now a log to read when it
misbehaves. Nothing that rendered correctly before renders differently now.

### Added

- **Raw HTML renders.** `<mark>`, `<kbd>`, `<details>`, a table written by hand,
  an `<img>` pointing at a file beside the document — markup you write now
  arrives as markup instead of as visible angle brackets. The boundary is the
  preview's Content-Security-Policy rather than the renderer: `<script>`, an
  `onclick=` attribute and an `<iframe>` are all still refused, and so is a
  `<form>` posting anywhere. This is the same arrangement VS Code's own Markdown
  preview uses. ([#20](https://github.com/ROG-stdioh/graphite-md/issues/20))
- **A `graphite.md` output channel**, opened with **graphite.md: Show Output**.
  It logs the extension and VS Code version at startup, every preview opened and
  closed, every render with its timing and what it found, and every image the
  preview declined to load with the reason it declined. When a preview is stuck,
  this is the thing to read — it is the extension narrating its own state rather
  than waiting for you to guess.
  ([#24](https://github.com/ROG-stdioh/graphite-md/issues/24))
- **Styling for elements that had none** — `kbd`, `details` and `summary`,
  `abbr`, `dl`/`dt`/`dd`, `figure`/`figcaption` and `hr`. They rendered as
  unstyled browser defaults before, which is what made raw HTML look broken even
  once it was arriving.

### Changed

- **A document with no diagram no longer loads a diagram renderer.** Mermaid is
  3.18 MB, and the preview parsed and executed the whole of it on every load
  whether or not the document contained a diagram — measured at 164 ms of a
  169 ms reload, which made it the cost of the preview by an order of magnitude.
  It is now loaded only when there is a diagram to draw: a document without one
  goes from nine resources to three, and from ~160 ms to under 25 ms.
  ([#22](https://github.com/ROG-stdioh/graphite-md/issues/22))
- **Typing no longer rebuilds the preview once per character.** The rebuild is
  debounced, so a burst of typing costs one render instead of one per keystroke,
  and a preview panel that isn't visible is skipped entirely and catches up when
  you come back to it.
  ([#22](https://github.com/ROG-stdioh/graphite-md/issues/22))
- **A table written as raw HTML joins the Tables view**, in document order
  alongside the Markdown ones. A table you gave an `id` keeps it, so a link
  written to `#totals` still lands where it always did.
  ([#21](https://github.com/ROG-stdioh/graphite-md/issues/21))

### Fixed

- **Folding a section now survives a reload.** A folded section was a class on
  the element and nothing else, so anything that reloaded the page — closing and
  reopening the preview, or an update — put every section back open. Which
  sections you folded is now remembered, the same way your scroll position
  already was. ([#22](https://github.com/ROG-stdioh/graphite-md/issues/22))
- **A blank outline now says so.** When every row in the outline failed to lay
  out, it cleared itself and reported nothing anywhere, which looks exactly like
  a document with no headings in it. It now warns to the output channel and
  names how many rows went missing.
  ([#22](https://github.com/ROG-stdioh/graphite-md/issues/22))

## [0.1.0] - 2026-09-17

Images, at last — and a preview that cannot go stale. Alongside them, two link
defects and a checklist that silently did nothing in some documents. Nothing
that rendered correctly before renders differently now.

### Added

- **Images render.** A picture next to the document now loads — resolved
  against the file it is written in, which is the one thing a Markdown preview
  has to get right and the one thing the renderer, a pure string function, could
  not do on its own. ([#14](https://github.com/ROG-stdioh/graphite-md/issues/14))
- **`graphiteMd.remoteImages`**, off by default. Images from the network stay
  blocked until you ask for them: a preview is a local reading surface, and
  turning this on lets any document you open make requests to servers its author
  picked, which tells them your IP and that you opened the file. Images stored
  beside the document are never affected.
  ([#14](https://github.com/ROG-stdioh/graphite-md/issues/14))

### Fixed

- **An upgrade can no longer leave the preview running the previous release's
  code.** VS Code's webview serves a cached copy of an asset across panel
  reopens, so a shipped fix could stay invisible after updating — silently, and
  for exactly the users who had upgraded. Each file the preview loads is now
  requested at a URL carrying a version derived from that file's own contents,
  so an unchanged file stays cached and a changed one cannot go unnoticed.
  ([#6](https://github.com/ROG-stdioh/graphite-md/issues/6))
- **A heading anchor resolves, and an external link opens once.** Clicking a
  `#some-heading` link did nothing, because the heading carried no id of its
  own; and a link to the outside world was opened twice, once by the preview and
  again by VS Code's own webview handler, which never checks whether a
  click was already handled. Both are fixed, and an anchor into a collapsed
  section now opens the ancestors it needs on the way.
  ([#16](https://github.com/ROG-stdioh/graphite-md/issues/16))
- **Checkboxes work again — in every document, not just simple ones.** Two
  independent defects made a rendered checkbox do nothing when clicked, with no
  error to say so. An HTML comment spanning several lines was stripped from the
  parse along with its line breaks, shifting every line number below it, so a
  box reported the wrong source line and the edit landed nowhere; and a
  checklist inside a blockquote was never matched in the first place, because
  the host's pattern for finding the box rejected the leading `>`. Both are
  fixed. ([#12](https://github.com/ROG-stdioh/graphite-md/issues/12))

## [0.0.2] - 2026-09-14

Two link-handling fixes, plus an internal rebuild: the whole project — extension,
webview and build tooling — is TypeScript, with static analysis gating every
change. One thing to check before upgrading: **this release needs a newer VS
Code than 0.0.1 did** (see Changed, below).

### Fixed

- **Filenames no longer render as web links.** Any bare `word.ext` was being
  linkified, and plenty of country domains are also file extensions — `.md`,
  `.sh`, `.rs`, `.pl`, `.so`, `.cc` — so a document that merely mentioned
  `README.md`, `setup.sh` or `lib.so` rendered them as links to
  `http://README.md` and friends. In a Markdown preview a `*.md` is
  overwhelmingly a filename. Explicit URLs and email addresses still linkify.
  ([#1](https://github.com/ROG-stdioh/graphite-md/issues/1))
- **Relative links open the file they point at.** Clicking `[setup](setup.md)`
  fell through to VS Code's webview handler, which read the bare path as a
  hostname and opened a website. Links now resolve against the document being
  previewed — matching VS Code's own Markdown preview — and absolute URLs open
  in your browser. ([#2](https://github.com/ROG-stdioh/graphite-md/issues/2))

### Added

- **A gallery** on the [docs site](https://rog-stdioh.github.io/graphite-md/),
  with real screenshots of the preview now in the README.

### Changed

- **graphite.md now requires VS Code 1.134.0 or later**, up from 1.85.0. The old
  floor was never real: the editor API the extension was typed against had
  drifted several releases behind the one it was built on, so the number
  promised compatibility nothing had verified since 0.0.1. If you are on an
  older VS Code, VS Code will not offer 0.0.2 as an update — update VS Code
  first, then the extension.
- The extension package no longer ships build and development files.
- **The whole project is TypeScript.** The extension host, the webview, and the
  build and test tooling each sit inside a checked compiler program — three of
  them, with deliberately different environments, so the browser code cannot
  reach for Node APIs and the host cannot reach for the DOM. The host ↔ webview
  message contract is a shared type both sides compile against, so it cannot
  drift without one of them failing to build.
- **Static analysis gates every change.** Type checking, type-aware linting,
  unused-code detection and a packaging check run on every pull request.

## [0.0.1] - 2026-09-14

Initial release.

### Added

- **Collapsible sections** — every heading in a document collapses and expands
  independently, so long specs stop being one continuous scroll.
- **Git-graph outline** — the "On this page" pane renders the document structure
  as a connected graph instead of a flat list, split into three views: Content
  (headings, nested), Tables, and Diagrams. Clicking a node soft-scrolls to it and
  opens any collapsed ancestors on the way; the outline highlights the current
  position as you scroll.
- **Checklists** — `- [ ]` and `- [x]` render as clickable checkboxes that edit the
  underlying markdown file directly.
- **Math** — inline `$...$` and block `$$...$$`, rendered with KaTeX.
- **Diagrams** — ` ```mermaid ` fenced blocks render as live diagrams.
- **Footnotes** — `[^1]` references collect into a numbered list at the foot of the
  preview, with working forward and back navigation.
- **Rich inline syntax** — superscript (`^2^`), subscript (`~2~`), underline
  (`++text++`), highlighting (`==text==`), and strikethrough (`~~text~~`).
- **Syntax highlighting** — fenced code blocks are highlighted with highlight.js
  using a palette tuned to the graphite theme; an unknown language falls back to
  plain monospace rather than failing.
- **Halftone callouts** — blockquotes get a dot-gradient treatment so notes and
  asides stand out from body text.
- **Tunable reading width** — the `graphiteMd.contentWidth` setting (40–100),
  applied to an open preview immediately.

[Unreleased]: https://github.com/ROG-stdioh/graphite-md/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ROG-stdioh/graphite-md/compare/v0.0.2...v0.1.0
[0.0.2]: https://github.com/ROG-stdioh/graphite-md/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/ROG-stdioh/graphite-md/releases/tag/v0.0.1
