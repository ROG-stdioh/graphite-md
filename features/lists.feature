Feature: Lists
  A list is the shape most documents use for everything from a shopping list to
  an API's parameters, and its whole meaning is structural: which kind of list
  an item is in, and what it is nested inside. None of that had a scenario —
  nothing in this repo asserted a `<ul>`, an `<ol>` or an `<li>`, so a renderer
  that turned every list into a paragraph passed the entire suite.

  # One table carries all three claims at once, because they fail together and
  # they fail differently. Swapping `<ul>` and `<ol>` moves the `kind` column,
  # flattening the nest moves `depth`, and dropping an item loses a row — and a
  # scenario that asserted only the item texts would survive all three.
  Scenario: A list keeps its kind, its order and its nesting
    Given a markdown document:
      """
      - one
      - two
        - nested a
        - nested b
          - deep

      1. first
      2. second
      """
    When the preview renders it
    Then the list reads:
      | kind | depth | item     |
      | ul   | 0     | one      |
      | ul   | 0     | two      |
      | ul   | 1     | nested a |
      | ul   | 1     | nested b |
      | ul   | 2     | deep     |
      | ol   | 0     | first    |
      | ol   | 0     | second   |

  # CommonMark calls a list "loose" when a blank line separates its items, and
  # wraps each item in a paragraph; a tight list does not. It is the difference
  # a reader sees as the space between items, and it is invisible to any
  # assertion that counts items rather than looking inside them.
  Scenario: A list written with blank lines between its items renders loosely
    Given a markdown document:
      """
      - one

      - two
      """
    When the preview renders it
    Then the list is rendered loose

  Scenario: A list written without blank lines renders tightly
    Given a markdown document:
      """
      - one
      - two
      """
    When the preview renders it
    Then the list is rendered tight

  # A numbered set of commands with an explanation under each is ordinary, and
  # it is the shape where a list stops being a list of sentences: the item holds
  # blocks. Dropping the blocks leaves the item's own words behind and looks
  # like a document that rendered, which is why each is asserted by name.
  Scenario: A list item can hold a code block
    Given a markdown document:
      """
      - Run the migration:

        ```sh
        npm run migrate
        ```

      - Restart the node.
      """
    When the preview renders it
    Then the list item "Run the migration:" holds a code block

  Scenario: A list item can hold a quote
    Given a markdown document:
      """
      - The note says:

        > Shorter version: a coordinator restart loses nothing.

      - And that is all.
      """
    When the preview renders it
    Then the list item "The note says:" holds a quote

  # The nesting is what carries the meaning in a step list, so the blocks and
  # the nest have to survive together rather than one at a time.
  Scenario: A nested list inside an item that holds a code block
    Given a markdown document:
      """
      - Deploy:
        - to staging

        ```sh
        npm run deploy
        ```
      """
    When the preview renders it
    Then the list reads:
      | kind | depth | item     |
      | ul   | 0     | Deploy:  |
      | ul   | 1     | to staging |
    Then the list item "Deploy:" holds a code block
