Feature: Reading a document
  A long document is easier to read when the preview knows what shape it has.
  The first heading names the document; every heading after it becomes a
  collapsible section, nested the way it was written.

  Scenario: The first heading names the document
    Given a markdown document:
      """
      # Shard Rebalancing

      ## Summary

      Shards move between storage nodes.
      """
    When the preview renders it
    Then the document title is "Shard Rebalancing"

  Scenario: A heading under the title becomes a collapsible section
    Given a markdown document:
      """
      # Shard Rebalancing

      ## Summary

      Shards move between storage nodes.
      """
    When the preview renders it
    Then the preview shows 1 collapsible sections
    Then the preview shows "Summary" as a heading

  Scenario: A document with no heading has no title
    Given a markdown document "Just a paragraph, with no heading above it."
    When the preview renders it
    Then the preview has no document title

  Scenario: A second top-level heading becomes a section rather than replacing the title
    Given a markdown document:
      """
      # First

      # Second

      ## Under second
      """
    When the preview renders it
    Then the document title is "First"
    Then the outline reads:
      | section      | depth |
      | Second       | 0     |
      | Under second | 1     |

  Scenario: Headings nest the way they are written
    Given a markdown document:
      """
      # Title

      ## Alpha

      ### Beta

      ## Gamma
      """
    When the preview renders it
    Then the outline reads:
      | section | depth |
      | Alpha   | 0     |
      | Beta    | 1     |
      | Gamma   | 0     |

  Scenario: A heading inside a blockquote is not a page section
    Given a markdown document:
      """
      # Title

      > ## Quoted

      Real content.
      """
    When the preview renders it
    Then the preview shows 0 collapsible sections
    Then the outline is empty

  Scenario: A heading inside a list item is not a page section
    Given a markdown document:
      """
      # Title

      - ## In a list
      """
    When the preview renders it
    Then the preview shows 0 collapsible sections
    Then the outline is empty

  # ---- anchors ------------------------------------------------------------
  # A section here is collapsible, so its body carries a prefixed id — and the
  # heading itself carried none at all. That left `#tables`, the anchor GitHub,
  # GitLab and VS Code's own Markdown preview all produce for `## Tables` and so
  # the one every author writes, resolving to nothing. The anchor belongs on the
  # heading: where the other renderers put it, and where a reader clicking a
  # link into a section expects to arrive.

  Scenario: A heading carries the anchor its own text makes
    Given a markdown document:
      """
      # Title

      ## Tables

      | a |
      |---|
      | 1 |
      """
    When the preview renders it
    Then the headings are anchored at:
      | anchor |
      | tables |

  Scenario: A repeated heading gets an anchor of its own
    Given a markdown document:
      """
      # Title

      ## Setup

      ## Setup
      """
    When the preview renders it
    Then the headings are anchored at:
      | anchor  |
      | setup   |
      | setup-1 |

  Scenario: Nested headings are anchored in the order they are read
    Given a markdown document:
      """
      # Title

      ## Alpha

      ### Beta

      ## Gamma
      """
    When the preview renders it
    Then the headings are anchored at:
      | anchor |
      | alpha  |
      | beta   |
      | gamma  |

  # The ids a render hands out come from two directions. A section body is its
  # heading's slug behind a `body-` prefix and an anchor is the bare slug, while
  # `table-1` and `diagram-1` come off a counter — so `## Body Text` is in line
  # for the id of a section called "Text", and `## Table 1` for the id the first
  # table is about to take. Neither is an exotic heading, and both would put two
  # elements under one id.

  Scenario: A heading cannot take the id of a section body
    Given a markdown document:
      """
      # Title

      ## Text

      ## Body Text
      """
    When the preview renders it
    Then no two elements share an id
    Then the headings are anchored at:
      | anchor       |
      | text         |
      | body-text-1  |

  Scenario: A heading cannot take the id the first table is about to claim
    Given a markdown document:
      """
      # Title

      ## Table 1

      | a | b |
      |---|---|
      | 1 | 2 |
      """
    When the preview renders it
    Then no two elements share an id
    Then the outline lists a table at "table-2"

  Scenario: A heading cannot take the id of a diagram
    Given a markdown document:
      """
      # Title

      ## Diagram 2

      ```mermaid
      graph TD; A-->B;
      ```

      ```mermaid
      graph TD; C-->D;
      ```
      """
    When the preview renders it
    Then no two elements share an id
    Then the outline lists 2 diagrams
