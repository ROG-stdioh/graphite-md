Feature: Math
  Math is typeset properly, whether it sits in a sentence or on its own line.
  The renderer is bundled with the extension, so none of this needs a network
  connection.

  # ---- which delimiters this renderer reads --------------------------------
  # `$…$` for inline and `$$…$$` for display, and nothing else. Which set is in
  # use is not a detail: it decides whether a document full of prices renders,
  # and it is the one thing a reader migrating from another preview would notice
  # first. These scenarios name the set rather than describing it.

  # The load-bearing case for a dollars-only renderer: a `$` in front of a digit
  # is a price and stays prose. Both checks are here because they catch different
  # readings — a renderer that opened a span on `$5` puts a formula where the
  # price was, which the count sees, and one that opened and then failed puts a
  # red error box there instead, which only the errors see.
  #
  # The price follows the formula rather than preceding it, and that is not
  # arbitrary. A price *before* a formula on the same line is issue #38: the
  # price's `$` opens a span and the formula's `$` closes it, swallowing
  # everything between them. Written the other way round this scenario would
  # pin that bug instead of the behaviour, so it is written this way until #38
  # is fixed.
  Scenario: A price in prose is not the start of a formula
    Given a markdown document "The area is $x^2$, and it costs $5 today."
    When the preview renders it
    Then the preview typesets 1 piece of math
    And the preview marks no math as bad
    And the math typeset on the page reads "x^2"
    And the preview shows the text "$5 today."

  Scenario: An escaped dollar is a dollar and not a delimiter
    Given a markdown document "Costs \$5 and \$10, while $x$ is maths."
    When the preview renders it
    Then the preview typesets 1 piece of math
    And the math typeset on the page reads "x"
    And the preview shows the text "Costs $5 and $10"

  # LaTeX's own delimiters, which other previews accept and this one does not.
  # The backslashes are consumed by Markdown's escape rule, so the reader sees
  # the parentheses as prose — which is the behaviour being pinned. A renderer
  # that started honouring `\(` would turn this sentence into a formula, and
  # nothing else in the suite would say so.
  Scenario: LaTeX-style delimiters are plain text here
    Given a markdown document "Inline \(x^2\) and display \[y^2\], but $z^2$ is maths."
    When the preview renders it
    Then the preview typesets 1 piece of math
    And the math typeset on the page reads "z^2"
    And the preview shows the text "Inline (x^2) and display [y^2]"

  # ---- the two placements --------------------------------------------------

  # Inline maths sits *within* a sentence, so the sentence has to survive on both
  # sides of it: a span that swallowed its lead-in, or one that ran past its
  # closing `$` and ate the rest of the line, are the two ways an inline rule
  # goes wrong. The text is asserted on each side rather than across, because
  # across is a string with two spaces in it.
  Scenario: Math inside a sentence
    Given a markdown document "The identity $e^{i\pi}+1=0$ is famous."
    When the preview renders it
    Then the preview renders it as inline math
    And the math typeset on the page reads "e^{i\pi}+1=0"
    And the preview shows the text "The identity"
    And the preview shows the text "is famous."

  Scenario: Math on its own line
    Given a markdown document:
      """
      The integral:

      $$
      \int_0^1 x\,dx
      $$
      """
    When the preview renders it
    Then the preview renders it as displayed math
    And the math typeset on the page reads "\int_0^1 x\,dx"

  Scenario: Malformed math is flagged instead of breaking the page
    Given a markdown document "Bad: $\frac{1}{$ here."
    When the preview renders it
    Then the render still produced a page
    Then the bad math is marked rather than breaking the page
