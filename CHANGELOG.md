# Changelog

All notable changes to graphite.md are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-10-05

The outline folds away, front matter renders as a table, and the preview stops
disagreeing with VS Code's own in three places it had quietly drifted. Behind
all of it: the preview now has a test suite behind it — the renderer, the editor
seam, and the live page — and most of the fixes below are things it found.

### Added

- **The outline pane folds away.** A chevron in the preview's top-right corner
  hides "On this page" and brings it back, **graphite.md: Toggle Outline** does
  the same from the Command Palette or `Ctrl+G O`, and the fold is remembered
  per preview panel — an edit that rebuilds the page does not spring it open
  again. With the pane gone the reading column takes the width, and the text
  re-wraps to match.
  ([#3](https://github.com/ROG-stdioh/graphite-md/issues/3))
- **Front matter renders as a table.** A YAML block at the top of a document —
  a title, a date, tags — arrives as key/value rows rather than as a stray
  heading in the outline, which is what VS Code's own preview does with it. The
  values are escaped rather than rendered as Markdown, and front matter that
  will not parse is reported as an error block instead of half a table.
  ([#47](https://github.com/ROG-stdioh/graphite-md/issues/47))
- **`graphiteMd.typographer`**, on by default: the straight quotes, `--` and
  `...` you type become their typographic forms, and code is never touched.
  This was always on; it is now a setting, named the way VS Code's own preview
  names it (`markdown.preview.typographer`) — which defaults to off, so a
  document can read slightly differently in the two previews.
  ([#34](https://github.com/ROG-stdioh/graphite-md/issues/34))
- **`graphiteMd.animation`**, on by default: turn it off and the outline folds
  instantly instead of animating. Worth doing if you read long documents in a
  narrow window, where an animated fold re-wraps the text under you for the
  length of it. Either way the fold follows the system's "reduce motion"
  setting.

### Changed

- **`Ctrl+K V` is no longer graphite.md's shortcut.** It is claimed by VS
  Code's built-in Markdown preview, so the same keystroke meant different things
  in different windows depending on which extension answered it. graphite.md's
  commands now sit under a chord nothing else claims: `Ctrl+G P` opens the
  preview, `Ctrl+G S` opens it to the side, `Ctrl+G O` folds the outline.
  ([#45](https://github.com/ROG-stdioh/graphite-md/issues/45))

### Fixed

- **A heading anchor keeps its non-Latin text.** `## 中文` was being reduced to
  `#section`, so a link written to it went nowhere. Anchors now keep Unicode
  letters, the way GitHub's do, while keeping the `section` fallback for a
  heading with nothing sluggable in it.
  ([#33](https://github.com/ROG-stdioh/graphite-md/issues/33))
- **A price no longer swallows the formula after it.** `$5 and $10` left the
  `$` characters unpaired and the next `$…$` in the paragraph was matched
  across them. ([#38](https://github.com/ROG-stdioh/graphite-md/issues/38))
- **Two `$$` placements no longer break their paragraph.** A line starting with
  `$$` dropped everything after the closing pair, and a `$$…$$` in the middle of
  a line put block markup inside a paragraph.
  ([#40](https://github.com/ROG-stdioh/graphite-md/issues/40),
  [#41](https://github.com/ROG-stdioh/graphite-md/issues/41))
- **A table or a diagram written above the first heading reaches the outline,
  and the table gets an `id`.** The scan for both views ran over each section's
  body and never over the intro block, so an intro table had no name at all —
  there was nothing for an entry to point at and nothing to link to.
  ([#44](https://github.com/ROG-stdioh/graphite-md/issues/44))
- **The outline's highlight reaches the end of a document.** It stopped
  advancing before the last heading, because a heading only counted once
  something below it was tall enough to push it past the reading line — and the
  last section's own body never is. Two more things about the same sweep: a
  heading inside a folded section could win it, since a hidden element measures
  as zeros and a top of zero is above every line; and folding a section did not
  ask for the sweep again at all, because a fold fires no scroll event.
  ([#35](https://github.com/ROG-stdioh/graphite-md/issues/35),
  [#36](https://github.com/ROG-stdioh/graphite-md/issues/36))
- **A document with no `#` heading no longer renders its first paragraph as a
  subtitle.** The subtitle rule reads "the first paragraph after the title",
  and it was applied to whichever paragraph came first, so a note that opens
  with a sentence had that line served a size and a colour larger than the rest.
  ([#39](https://github.com/ROG-stdioh/graphite-md/issues/39))
- **The first paint is no longer a 300×150 miniature.** VS Code hands the panel
  its document before the panel around it has been laid out, and the page was
  written into a frame with no size of its own — where the fixed-width outline
  is the whole viewport and the reading pane collapses to nothing. The page now
  holds itself back until the frame has a size, painting the panel's own
  background in the meantime.
  ([#46](https://github.com/ROG-stdioh/graphite-md/issues/46))

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

[Unreleased]: https://github.com/ROG-stdioh/graphite-md/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/ROG-stdioh/graphite-md/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ROG-stdioh/graphite-md/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ROG-stdioh/graphite-md/compare/v0.0.2...v0.1.0
[0.0.2]: https://github.com/ROG-stdioh/graphite-md/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/ROG-stdioh/graphite-md/releases/tag/v0.0.1
