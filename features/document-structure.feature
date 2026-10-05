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

  # Both of these assert an absence, so both carry the control that makes it
  # mean something: the heading renders as a heading, and it is still not a
  # section. Without that line, "0 collapsible sections" is equally satisfied by
  # a renderer that dropped the heading on the floor.
  Scenario: A heading inside a blockquote is not a page section
    Given a markdown document:
      """
      # Title

      > ## Quoted

      Real content.
      """
    When the preview renders it
    Then the preview shows "Quoted" as a heading
    Then the preview shows 0 collapsible sections
    Then the outline is empty

  Scenario: A heading inside a list item is not a page section
    Given a markdown document:
      """
      # Title

      - ## In a list
      """
    When the preview renders it
    Then the preview shows "In a list" as a heading
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

  # Letters outside ASCII are part of a heading's name, and the anchor is the
  # name. Stripping them is silent in both directions: a link written for
  # GitHub (`#café`) resolves to nothing here, and a headline in a script the
  # rule cannot spell collapses to the fallback — `#section`, `#section-1` — so
  # a reader of a Japanese document has no linkable name for anything.

  Scenario: Letters outside ASCII are kept in the anchor
    Given a markdown document:
      """
      # Title

      ## Café

      ## Über

      ## 日本語
      """
    When the preview renders it
    Then the headings are anchored at:
      | anchor |
      | café   |
      | über   |
      | 日本語 |

  # Half a letter is not a letter. Devanagari and the other Indic scripts write
  # their vowels as combining marks that follow the consonant they belong to, so
  # a rule that keeps letters and drops marks does not shorten this word, it
  # misspells it.
  Scenario: Combining marks are part of the letter they belong to
    Given a markdown document:
      """
      # Title

      ## हिन्दी
      """
    When the preview renders it
    Then the headings are anchored at:
      | anchor |
      | हिन्दी  |

  Scenario: A repeated heading keeps its own name when the name is not ASCII
    Given a markdown document:
      """
      # Title

      ## 日本語

      ## 日本語
      """
    When the preview renders it
    Then the headings are anchored at:
      | anchor   |
      | 日本語   |
      | 日本語-1 |

  # The other half of that rule, and the reason it is written as "what survives"
  # rather than "what goes": punctuation is still dropped, and GitHub's slug does
  # the same with it.
  Scenario: Punctuation and the underscore
    Given a markdown document:
      """
      # Title

      ## C++

      ## What's new?

      ## A, B, and C

      ## foo_bar
      """
    When the preview renders it
    Then the headings are anchored at:
      | anchor    |
      | c         |
      | whats-new |
      | a-b-and-c |
      | foo_bar   |

  # Not every heading has a name. `## !!!` has none in any rule, and the
  # fallback is ours — GitHub has no equivalent — so it is pinned here with the
  # duplicate rule that has to keep working underneath it.
  Scenario: A heading with nothing to keep still gets an anchor of its own
    Given a markdown document:
      """
      # Title

      ## !!!

      ## ???
      """
    When the preview renders it
    Then the headings are anchored at:
      | anchor    |
      | section   |
      | section-1 |

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

  # ---- front matter --------------------------------------------------------
  # `---` at the top of the file is front matter to every tool that reads these
  # documents — Jekyll, Hugo, VS Code's own Markdown preview, GitHub's
  # rendering of a README. Left to the ordinary block rules it is a rule, then a
  # heading, then another rule, which is where the first two scenarios below
  # come from: the metadata is drawn as the table VS Code draws for it, and it
  # is drawn *as a table* rather than as the shape the plain rules would make.
  #
  # What it must never do is hide the document with it. A block that runs from
  # the first line to the end of the file because nothing closed it looks
  # exactly like a block that worked, and it is why no scenario here ends on the
  # table: each one finishes with what rendered below the block.

  Scenario: Front matter is drawn as a table above the title
    Given a markdown document:
      """
      ---
      title: Shard Rebalancing
      tags: [storage, replication]
      ---

      # Title

      Body text.
      """
    When the preview renders it
    Then the document title is "Title"
    Then the preview draws the front matter as a table
    Then the front matter table has 2 rows
    Then the front matter row "title" holds "Shard Rebalancing"
    Then the front matter row "tags" holds a list of 2 items
    Then the preview shows the text "Body text."

  # The reason the values are read by a YAML parser rather than by splitting
  # each line on its first colon, which is the shape this would otherwise have
  # been written in. A colon inside quotes, and a boolean that is not the word
  # "true" but the value true, are both ordinary front matter.
  Scenario: A value only a YAML parser reads correctly
    Given a markdown document:
      """
      ---
      title: "Rebalancing: a note"
      draft: true
      ---

      # Title
      """
    When the preview renders it
    Then the document title is "Title"
    Then the front matter row "title" holds "Rebalancing: a note"
    Then the front matter row "draft" holds "true"

  # Front matter is the one part of a document that arrives from a tool rather
  # than from the author, which is why its values are shown as text. The title
  # below has to reach the page as the characters that were written, and the
  # `<img>` count is the other half of the same claim: markup in a value is not
  # markup, and there is nothing there for it to have become.
  Scenario: A value is text and not markup
    Given a markdown document:
      """
      ---
      title: <img src=x onerror=alert(1)>
      metadata:
        type: user
      ---

      # Title
      """
    When the preview renders it
    Then the front matter row "title" holds "<img src=x onerror=alert(1)>"
    Then the front matter row "metadata" holds the YAML "type: user"
    Then the preview shows 0 img elements

  # A document whose front matter is malformed is still a document. Throwing
  # would take the preview down and hide the writing along with the metadata.
  Scenario: Unparseable front matter is reported, not thrown
    Given a markdown document:
      """
      ---
      title: "unclosed
      ---

      # Title

      Body text.
      """
    When the preview renders it
    Then the preview reports a front matter error
    Then the document title is "Title"
    Then the preview shows the text "Body text."

  # The Tables view lists the document's tables, and the metadata block is not
  # one of them: an entry above every other, scrolling to a grid of keys, would
  # be the outline describing its own plumbing. Counted rather than named,
  # because the fault is a table that should not be in the list at all.
  Scenario: The front matter table is not one of the document's tables
    Given a markdown document:
      """
      ---
      title: Shard Rebalancing
      ---

      # Title

      | a | b |
      |---|---|
      | 1 | 2 |
      """
    When the preview renders it
    Then the outline lists 1 tables

  Scenario: Front matter does not take the document with it
    Given a markdown document:
      """
      ---
      title: Shard Rebalancing
      ---
      # Title

      ## Summary

      Body text.
      """
    When the preview renders it
    Then the document title is "Title"
    Then the outline reads:
      | section | depth |
      | Summary | 0     |

  # Only the very top of the file. A blockquote's content is tokenized against
  # the same state as the rest of the document with the `>` markers already
  # stripped, so a rule on the first line of a quote reaches this rule looking
  # exactly like a fence at line 0 — and a quote that opens and closes with one
  # would have its middle quietly eaten.
  Scenario: A rule inside a blockquote is not front matter
    Given a markdown document:
      """
      > ---
      > A quoted line.
      > ---
      >
      > Quoted text.

      Body text.
      """
    When the preview renders it
    Then the preview shows the text "A quoted line."
    Then the preview shows the text "Quoted text."
    Then the preview shows the text "Body text."

  # The other direction: a rule that never closes is a rule. Reading to the end
  # of the file for a delimiter that is not there would silently delete the
  # document, and this is the scenario that says so.
  Scenario: A rule that is never closed is still a rule
    Given a markdown document:
      """
      ---
      Just a document that opens with a rule.
      """
    When the preview renders it
    Then the preview shows the text "Just a document that opens with a rule."
