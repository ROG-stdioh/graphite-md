Feature: Inline syntax
  The syntax people reach for when writing prose that isn't just prose —
  superscript, subscript, underline, highlight, strikethrough, footnotes.

  Scenario: Superscript and subscript
    Given a markdown document "Einstein's mc^2^ and water's H~2~O."
    When the preview renders it
    Then the preview shows "2" as superscript
    Then the preview shows "2" as subscript

  Scenario: Underline, highlight and strikethrough
    Given a markdown document "Keep ++this++, ==this== and ~~not this~~."
    When the preview renders it
    Then the preview underlines "this"
    Then the preview highlights "this"
    Then the preview strikes through "not this"

  Scenario: A footnote is rendered at the foot of the page
    Given a markdown document:
      """
      The plan is a pure function of observed disk pressure.[^1]

      [^1]: Shorter version: a coordinator restart loses nothing.
      """
    When the preview renders it
    Then the note is rendered at the foot of the page

  Scenario: A footnote links back to the sentence that cited it
    Given a markdown document:
      """
      The plan is a pure function of observed disk pressure.[^1]

      [^1]: Shorter version: a coordinator restart loses nothing.
      """
    When the preview renders it
    Then the note is rendered at the foot of the page
    Then the note links back to the sentence that cited it
