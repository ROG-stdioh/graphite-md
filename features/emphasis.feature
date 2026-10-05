Feature: Emphasis
  Italics and bold are the two things a document uses most and the two this
  suite asserted least: `<em>` appeared nowhere in the repo, `<strong>` nowhere,
  and the pair is the one place a renderer's marker handling is visible at all.
  Every payload below differs from every other, so no two markers can be
  exchanged without moving an assertion.

  Scenario: Both spellings of italics and of bold
    Given a markdown document "*stars* and _underscores_ and **doubled** and __doubled too__."
    When the preview renders it
    Then the preview shows "stars" in italics
    And the preview shows "underscores" in italics
    And the preview shows "doubled" in bold
    And the preview shows "doubled too" in bold

  # Three markers, which CommonMark reads as one inside the other rather than as
  # a third kind of emphasis. A renderer that treated `***` as its own token, or
  # that dropped one of the pair, leaves the text on the page with the wrong
  # tags around it — and the two scenarios above would still pass.
  #
  # The nesting is asserted, not just the two tags: `***x***` and `**_x_**`
  # both put the text in a `<strong>` and an `<em>`, and only one of them is
  # what the author wrote.
  Scenario: A triple marker is bold inside italics
    Given a markdown document "***both at once***"
    When the preview renders it
    Then the preview shows "both at once" in bold inside the italics "both at once"
    And the preview shows "both at once" in italics

  # The nesting itself, which the two membership assertions above cannot see:
  # both are satisfied by a `<strong>` and an `<em>` sitting side by side.
  Scenario: Emphasis nests inside bold
    Given a markdown document "**bold with *italic* inside**"
    When the preview renders it
    Then the preview shows "italic" in italics inside the bold "bold with italic inside"

  # CommonMark leaves an underscore alone inside a word, which matters more here
  # than in most renderers: a document about code is full of `snake_case`, and a
  # rule that read every underscore as a marker would silently turn identifiers
  # into italics. The document carries one real emphasis as the control, so the
  # step cannot be satisfied by a renderer that stopped emitting `<em>`.
  Scenario: An underscore inside a word is not emphasis
    Given a markdown document "Call the snake_case_helper, and _a real one_ too."
    When the preview renders it
    Then the italics on the page are exactly "a real one"
    And the preview shows the text "snake_case_helper"
