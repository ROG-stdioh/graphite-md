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

  # The scenario above is named "at the foot of the page" and said nothing about
  # which note is which. A footnote list is numbered by the order the sentences
  # cite it rather than by the order the definitions were written — which is the
  # behaviour a reader would notice being wrong, and it is invisible to a
  # scenario with one footnote.
  #
  # The definitions here are deliberately in the opposite order to the
  # citations, so a renderer that numbered by definition order swaps the two
  # rows. The one-citation order is in the table because it is the half that
  # would otherwise be taken for granted.
  Scenario: Notes are numbered in the order the sentences cite them
    Given a markdown document:
      """
      First ref.[^b] Then another.[^a]

      [^a]: note A
      [^b]: note B
      """
    When the preview renders it
    Then the notes are numbered in the order they are first cited:
      | label | note   |
      | [1]   | note B |
      | [2]   | note A |

  # A definition with no sentence pointing at it. The plugin drops it, which is
  # the right answer — an unreferenced note has no number to be — and it is a
  # claim only a document with a cited note beside it can make. The count is
  # what turns "not shown" into evidence: without it, a renderer that dropped
  # every note satisfies the same assertion.
  Scenario: A definition that is never cited is not shown
    Given a markdown document:
      """
      A ref.[^1]

      [^1]: cited
      [^2]: never cited
      """
    When the preview renders it
    Then the preview shows 1 notes
    And the preview does not show "never cited"

  # The same sentence cited twice by two different sentences. One note, two
  # citations, and both of them have to point at it — the ids invented for the
  # second citation are what keeps the document's promise that no two elements
  # share one.
  Scenario: A note cited twice is one note with two citations
    Given a markdown document:
      """
      Once.[^1] Again.[^1]

      [^1]: the note
      """
    When the preview renders it
    Then the preview shows 1 notes
    And the notes are numbered in the order they are first cited:
      | label | note     |
      | [1]   | the note |

  # ---- the typographer ------------------------------------------------------
  # Straight quotes to curly, `--` to an en dash, `...` to an ellipsis —
  # markdown-it's typographer, and a setting here because the two previews a
  # reader might compare disagree about it by default: VS Code's preview has the
  # same option (`markdown.preview.typographer`) with it off, this one with it
  # on. Both directions are asserted, because a setting that cannot be turned
  # off and one that cannot be turned on fail in the same way from the outside.

  Scenario: Straight characters stay as typed when the typographer is off
    Given the typographer is off
    And a markdown document:
      """
      He said -- "hello" ... and left.
      """
    When the preview renders it
    Then the preview shows the text "He said -- \"hello\" ... and left."

  Scenario: The typographer turns the characters you typed into their forms
    Given the typographer is on
    And a markdown document:
      """
      He said -- "hello" ... and left.
      """
    When the preview renders it
    Then the preview shows the text "He said – “hello” … and left."

  # The default is the half that diverges from VS Code, so it is pinned rather
  # than left to the setting's own documentation to state.
  Scenario: With no setting at all, the typographer is on
    Given a markdown document:
      """
      He said -- "hello" ... and left.
      """
    When the preview renders it
    Then the preview shows the text "He said – “hello” … and left."

  # The setting's own description makes this promise, so it is a scenario
  # rather than a remark: a code block and an inline span both hold text that
  # looks exactly like what the typographer rewrites, and a document full of
  # command-line flags would be unreadable if it got in there.
  Scenario: The typographer leaves code as it was typed
    Given the typographer is on
    And a markdown document:
      """
      Inline `-- "code" ...` stays as typed.

      ```text
      -- "code" ...
      ```
      """
    When the preview renders it
    Then the preview shows "-- \"code\" ..." as inline code
    Then the code shows the literal text "-- \"code\" ..."
