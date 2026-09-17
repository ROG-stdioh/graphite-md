Feature: Task lists
  A checklist is only a checklist if you can use it. The preview renders
  `- [ ]` as a real checkbox, and ticking one changes the file on disk rather
  than a copy of it held in the preview.

  Background:
    Given a markdown document:
      """
      ## Pre-flight

      - [x] Check compatibility
      - [x] Take a snapshot
      - [ ] Coordinator is on 2.x
      - [ ] 25% free disk
      """
    When the preview renders it

  Scenario: Markdown task syntax becomes real checkboxes
    Then the preview shows 4 task items

  Scenario: A ticked box is distinguishable from an open one
    Then the preview shows 4 task items
    Then 2 of them are ticked

  Scenario: Every checkbox knows the line it came from
    Then every task item knows which line of the file it came from
    And every checkbox can be toggled in the source file

  # The line a box reports is a line of the *file*, and the renderer strips
  # HTML comments before it parses. A comment spanning several lines used to
  # take its line breaks with it, shifting every line below — so every box
  # still reported a line, and every one of them pointed at the wrong text.
  Scenario: A box still points at its own line past a multi-line comment
    Given a markdown document:
      """
      <!-- a note
           spanning three
           whole lines -->

      - [x] first
      - [ ] second
      """
    When the preview renders it
    Then the preview shows 2 task items
    And every checkbox can be toggled in the source file

  Scenario: A checklist nested inside another one is editable
    Given a markdown document:
      """
      - [ ] parent
        - [ ] child
      """
    When the preview renders it
    Then the preview shows 2 task items
    And every checkbox can be toggled in the source file

  # A checklist is not confined to a top-level list: markdown puts one inside a
  # blockquote just as happily, and the renderer has always drawn it. What was
  # missing was the other half — the host finding the box in the source line,
  # where the leading ">" defeated the match.
  Scenario Outline: A box is editable wherever the bullet sits
    Given a markdown document:
      """
      <line>
      """
    When the preview renders it
    Then the preview shows 1 task item
    And every checkbox can be toggled in the source file

    Examples:
      | line                    |
      | - [ ] plain             |
      | - [x] plain, ticked     |
      | * [ ] star bullet       |
      | + [ ] plus bullet       |
      | > - [ ] quoted          |
      | > - [x] quoted, ticked  |
      | > > - [ ] doubly quoted |

  Scenario: A plain list is left alone
    Given a markdown document:
      """
      - just a list item
      - and another
      """
    When the preview renders it
    Then the preview shows 0 task items
