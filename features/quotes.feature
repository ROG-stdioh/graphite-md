Feature: Quotes
  Every blockquote is rewritten into a callout, and the rewrite is where this
  renderer has broken its own page worst. A heading inside a quote once split
  the open and close tokens across two sections, and the browser repaired the
  mismatched tags by renesting the rest of the document inside the quote — the
  whole right-hand pane ended up at the bottom of the page.

  The rule itself was asserted nowhere. What stood in for a test was a loop
  counting `<blockquote>` opens against closes, which is 0 against 0 — a pass —
  for a document whose quotes stopped rendering at all. So these scenarios
  assert the class, the count, and both halves of where a quote ends.

  Scenario: A quote is rendered as a callout
    Given a markdown document:
      """
      > A note the author wants set apart.
      """
    When the preview renders it
    Then the preview shows 1 quotes
    And every quote is rendered as a callout

  # The regression this whole file exists for. A heading is the token that broke
  # it, and the damage was invisible to anything that only asked whether the text
  # survived: the page still contained every word, in a layout nobody wrote.
  #
  # All four claims are needed together. The section count is what catches the
  # heading being hoisted out into document structure; "as a heading" is the
  # positive control, so 0 sections cannot be satisfied by 0 headings; the inside
  # claim is where the heading belongs; the outside claim is the renesting, which
  # is what a reader would actually have seen.
  Scenario: A heading inside a quote stays inside the quote
    Given a markdown document:
      """
      > ## Title
      >
      > Body after the heading.

      After the quote.
      """
    When the preview renders it
    Then the preview shows 0 collapsible sections
    And the preview shows "Title" as a heading
    And the text "Title" is rendered inside the quote
    And the text "After the quote." is rendered outside every quote

  # A list is the other container that opens and closes inside a quote, and it
  # is the shape a quoted set of instructions takes.
  Scenario: A list inside a quote stays inside the quote
    Given a markdown document:
      """
      > Intro line.
      >
      > - one
      > - two

      After the quote.
      """
    When the preview renders it
    Then the preview shows 0 collapsible sections
    And the preview shows 1 quotes
    And the text "one" is rendered inside the quote
    And the text "After the quote." is rendered outside every quote

  # Two quotes are two quotes. The count and the class are asserted together
  # because a rule that rewrote only the first one, or closed the first callout
  # and swallowed the second into it, satisfies either alone.
  Scenario: A document with two quotes renders both of them separately
    Given a markdown document:
      """
      > first

      between

      > second
      """
    When the preview renders it
    Then the preview shows 2 quotes
    And every quote is rendered as a callout
    And the text "first" is rendered inside the quote
    And the text "second" is rendered inside the quote
    And the text "between" is rendered outside every quote

  # A quote inside a quote is the case where three separate claims have to hold
  # at once. The inner open tag is a token of the outer quote's body like any
  # other, so a renderer that emitted the class from the outer rule alone leaves
  # the inner one a bare `<blockquote>`; and a count of two is satisfied by two
  # quotes sitting side by side, which is a different document.
  Scenario: A quote inside a quote is a callout too
    Given a markdown document:
      """
      > outer
      >
      > > inner
      """
    When the preview renders it
    Then the preview shows 2 quotes
    And every quote is rendered as a callout
    And the preview shows 1 quote nested inside a quote
    And the outermost quote reads "outer"
