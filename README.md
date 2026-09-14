# graphite.md

A Markdown preview for people who read a lot of Markdown: collapsible
sections, a git-graph style outline, checklists, math, and diagrams — in a
dark, distraction-free theme.

**[Documentation](https://rog-stdioh.github.io/graphite-md/)** ·
**[Marketplace](https://marketplace.visualstudio.com/items?itemName=rog-stdioh.graphite-md)** ·
**[Issues](https://github.com/ROG-stdioh/graphite-md/issues)**

![The graphite.md preview showing an engineering RFC: rendered markdown on the left, and beside it the outline panel drawing the document's structure as a connected graph.](images/overview.png)

## Features

**Collapsible sections.** Every heading in your document collapses and
expands independently. Long specs and READMEs stop being one giant scroll.

**A git-graph outline.** The right-hand "On this page" pane shows your
document's structure as a connected graph — not a flat list — split into
three views:
- **Content** — your heading structure, nested exactly as it is in the doc
- **Tables** — every table in the document, jump straight to any of them
- **Diagrams** — every diagram, same idea

Only one view is open at a time. Click any node to soft-scroll to that part
of the document; the outline highlights where you are as you scroll.

![The preview scrolled to a deeply nested heading. In the outline panel, the path from Content down to the current section is drawn in accent, and the section itself is highlighted.](images/outline.png)

**Checklists.** Write `- [ ]` and `- [x]` as usual. In the preview they
render as real, clickable checkboxes — checking one off edits your markdown
file directly, so your task list and your document never drift apart.

![A split view of a runbook: markdown source on the left, the same pre-flight section rendered on the right with four of six checkboxes ticked. Clicking a box in the preview rewrites the matching line in the file.](images/checklists.png)

**Math.** Inline (`$...$`) and block (`$$...$$`) math, rendered with KaTeX.

**Diagrams.** Fenced ` ```mermaid ` code blocks render as live diagrams.

![Two captures side by side. On the left, a systems paper rendering inline and displayed math alongside a markdown table. On the right, a mermaid fenced code block rendered as a flow diagram of a coordinator fanning out to five replicas.](images/math-and-diagrams.png)

**Callouts.** Blockquotes (`>`) get a distinct treatment so notes and
asides stand out from body text.

**Rich inline syntax.** Superscript (`^2^`), subscript (`~2~`), underline
(`++text++`), highlighting (`==text==`), strikethrough (`~~text~~`), and
footnotes (`[^1]`) all render natively.

![A document exercising inline syntax: subscript, superscript, underline, highlight and strikethrough all rendered in place, with a footnote marker in the body and its definition listed at the foot of the page.](images/inline-syntax.png)

**Syntax highlighting.** Fenced code blocks are highlighted with
highlight.js, tinted to match the graphite theme.

**Tunable reading width.** Set it once in `settings.json`:

```json
"graphiteMd.contentWidth": 60
```

## Usage

1. Open a `.md` file.
2. Run **graphite.md: Open Preview to the Side** from the Command Palette,
   or press `Ctrl+K V` (`Cmd+K V` on macOS).
3. The preview updates live as you type.

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `graphiteMd.contentWidth` | number (40–100) | `60` | Width of the reading column, as a percentage of the available preview pane width. |

## Requirements

VS Code 1.85.0 or later. No other setup — everything the preview needs
(KaTeX, Mermaid) ships bundled with the extension.

## Known limitations

- Merged-cell tables aren't supported yet — a syntax for this is still
  being designed.
- The preview doesn't yet follow the editor cursor (or vice versa).

## Contributing

See `DEVELOPMENT.md` for build instructions and an overview of how the
extension is put together.

## License

MIT
