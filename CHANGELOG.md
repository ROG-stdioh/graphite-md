# Changelog

All notable changes to graphite.md are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Two link-handling fixes, plus an internal rebuild: the source is now TypeScript
throughout, with static analysis gating every change.

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

- The extension package no longer ships build and development files.
- The source moved to TypeScript, with type checking, type-aware linting,
  unused-code detection and a packaging check gating every change.

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

[Unreleased]: https://github.com/ROG-stdioh/graphite-md/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/ROG-stdioh/graphite-md/releases/tag/v0.0.1
