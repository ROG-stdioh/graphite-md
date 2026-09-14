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

  Scenario: A plain list is left alone
    Given a markdown document:
      """
      - just a list item
      - and another
      """
    When the preview renders it
    Then the preview shows 0 task items
