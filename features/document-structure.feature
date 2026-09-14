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
