Feature: Tables
  A table's alignment is written in the delimiter row and carried to the page as
  a `style` on each cell, header and body alike. The sample document writes all
  four alignments and nothing asserted one of them, so the whole column of
  behaviour — a renderer that aligned nothing, or applied the header's alignment
  and dropped the body's — was free.

  A table is also the only block whose id is assigned by a scan over the
  finished HTML rather than by the rule that emits it, which makes its shape and
  its name two different questions. The shape is here; the name is in the
  outline.

  Scenario: A table keeps its columns and its rows
    Given a markdown document:
      """
      # Report

      | metric | value | note |
      | ------ | ----- | ---- |
      | rows   | 12    | ok   |
      | time   | 4s    | ok   |
      """
    When the preview renders it
    Then the preview shows a table with 3 columns and 2 rows

  # All four alignments in one table, because they are one rule: the delimiter
  # row is parsed once per column and the result is attached to every cell under
  # it. A renderer that read only the first column's marker, or that defaulted
  # everything to left, moves one column of the table and leaves the rest.
  #
  # The unaligned column is in here deliberately. It is the positive control for
  # the other three: a table whose columns are all aligned proves a renderer
  # emits alignments, and says nothing about whether it invents one where the
  # author wrote none.
  Scenario: A table aligns each column the way its delimiter row says
    Given a markdown document:
      """
      # Report

      | left | centre | right | none |
      | :--- | :----: | ----: | ---- |
      | a    | b      | c     | d    |
      """
    When the preview renders it
    Then the table aligns its columns:
      | column | align  |
      | left   | left   |
      | centre | center |
      | right  | right  |
      | none   | none   |

  # A table written without a single marker. Every cell takes no alignment at
  # all, which is what stops the scenario above from being satisfied by a
  # renderer that stamps `text-align: left` on everything and happens to be
  # right about one column.
  Scenario: A table with no alignment row aligns nothing
    Given a markdown document:
      """
      # Report

      | a | b |
      | - | - |
      | 1 | 2 |
      """
    When the preview renders it
    Then the table aligns its columns:
      | column | align |
      | a      | none  |
      | b      | none  |
