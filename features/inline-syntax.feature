Feature: Inline syntax
  The syntax people reach for when writing prose that isn't just prose —
  superscript, subscript, underline, highlight, strikethrough, footnotes.

  # The two markers carry different text, and that is the whole point. While
  # both wrapped a bare "2", exchanging the superscript and subscript plugins
  # satisfied both lines — so the scenario could not fail for the one fault it
  # exists to catch, which is the marker and the tag being wired up crossed.
  Scenario: Superscript and subscript
    Given a markdown document "The 3^rd^ attempt, and CO~2~ levels."
    When the preview renders it
    Then the preview shows "rd" as superscript
    Then the preview shows "2" as subscript

  # Same repair: `++this++` and `==this==` both asserted on the word "this", so
  # <ins> and <mark> could be exchanged. The payloads differ now.
  Scenario: Underline, highlight and strikethrough
    Given a markdown document "Mark ++this++ and ==that==, but ~~not the rest~~."
    When the preview renders it
    Then the preview underlines "this"
    Then the preview highlights "that"
    Then the preview strikes through "not the rest"

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
