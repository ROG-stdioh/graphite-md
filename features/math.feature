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

  # ---- a price *before* a formula -------------------------------------------
  # Issue #38, and the hazard the dollars-only set actually carries. The rule
  # paired the first `$` it saw with the next `$` its own guard would accept, so
  # in `$5, and $x^2$` the price opened a span and the formula's own opening `$`
  # closed it. Everything between them became one formula, the page showed a red
  # error box where the sentence had been, and the maths the author wrote did not
  # render at all.
  #
  # The rule that fixes it is the one VS Code's preview already uses, read from
  # extensions/markdown-math and @vscode/markdown-it-katex: a `$` opens only if
  # the *next* `$` can legally close it. An opener whose next `$` is preceded by
  # a space is not an opener, and the scan resumes at that `$` rather than
  # running on past it to a later one.
  Scenario: A price before a formula does not swallow it
    Given a markdown document "It costs $5, and $x^2$ is the area."
    When the preview renders it
    Then the preview typesets 1 piece of math
    And the preview marks no math as bad
    And the math typeset on the page reads "x^2"
    And the preview shows the text "It costs $5, and"

  # The same fault with the digits further apart, which is the shape the issue
  # was filed from. The count is what separates "the author's one formula" from
  # "one formula and one accident" — a page carrying both looks plausible.
  Scenario: Two prices before a formula
    Given a markdown document "It costs $5, and the other costs $10, unlike $x + y$ which is maths."
    When the preview renders it
    Then the preview typesets 1 piece of math
    And the preview marks no math as bad
    And the math typeset on the page reads "x + y"

  # The closer is the next `$`, but an escaped `$` is not a delimiter at all.
  # VS Code skips it when hunting for the closer and so must this, or the fix for
  # the two scenarios above would cost a formula KaTeX can read: `\$` is a
  # literal dollar in TeX, so this is a sentence about a currency amount.
  Scenario: An escaped dollar inside a formula is not a delimiter
    Given a markdown document "The price $\text{US\$}$ is a dollar."
    When the preview renders it
    Then the preview renders it as inline math
    And the preview marks no math as bad
    And the math typeset on the page reads "\text{US\$}"

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

  # ---- a formula at the start of a line --------------------------------------
  # Issue #40. texmath's two `$$…$$` *block* rules match at the start of a line
  # and then consume the whole rest of it — the rule moves the parser's line
  # cursor past the line's end — so anything written after the closing `$$` on
  # the same line was never handed to a later rule. It did not render as text,
  # escaped or otherwise: it was gone.
  #
  # VS Code's preview does not have this. Its block rule declines unless the
  # closing `$$` ends the line, and the line then goes to the inline rule, which
  # keeps the text. The fix converges on that split: the block rule owns a line
  # that is only maths, the inline rule owns everything else.
  Scenario: A formula at the start of a line keeps the text after it
    Given a markdown document:
      """
      ## Notes

      $$x^2$$ is the area.
      """
    When the preview renders it
    Then the preview typesets 1 piece of math
    And the math typeset on the page reads "x^2"
    And the preview shows the text "is the area."

  Scenario: Two formulas on one line keep the text between them
    Given a markdown document:
      """
      ## Notes

      $$x^2$$ and $$y^2$$ on one line.
      """
    When the preview renders it
    Then the preview typesets 2 pieces of math
    And the math typeset on the page reads "x^2"
    And the math typeset on the page reads "y^2"
    And the preview shows the text "on one line."

  # The control for both of the above, and the case the narrowing must not cost:
  # a line that is only a formula stays on the block path. The discriminator is
  # the paragraph — the block template is emitted beside the paragraphs, while
  # a formula the block rule declined would come back through the inline rule,
  # which is wrapped in one. Both routes show maths, so "displayed math" alone
  # would not tell them apart.
  Scenario: A formula alone on a line is still a block
    Given a markdown document:
      """
      ## Notes

      $$x^2$$
      """
    When the preview renders it
    Then the preview renders it as displayed math
    And the preview shows 0 p elements

  # ---- a formula in the middle of a sentence ---------------------------------
  # Issue #41. texmath's inline `$$…$$` template wraps the formula in a
  # `<section>`, which is block markup — so a formula written *inside* a
  # sentence arrived as a `<section>` inside the sentence's `<p>`. A `<p>`
  # cannot contain a `<section>`, so the browser's error recovery closed the
  # paragraph at the formula: the sentence became `<p>The area</p>`, the maths,
  # then "is large." as a loose text node outside any paragraph. The page read
  # correctly, and the repair was the browser's rather than something the
  # markup said.
  #
  # Nothing needs the wrapper: display maths is block because KaTeX's own
  # `.katex-display{display:block}` says so, and no rule here styles `section`
  # or `eqn`. Only the inline template changes — a `$$…$$` line on its own is a
  # block token, whose `<section>` sits beside the paragraphs rather than
  # inside one.
  Scenario: A formula written mid-sentence stays in its sentence
    Given a markdown document:
      """
      ## Notes

      The area $$x^2$$ is large.
      """
    When the preview renders it
    Then the preview typesets 1 piece of math
    And the preview renders it as displayed math
    And a single paragraph holds both "The area" and "is large."

  Scenario: Malformed math is flagged instead of breaking the page
    Given a markdown document "Bad: $\frac{1}{$ here."
    When the preview renders it
    Then the render still produced a page
    Then the bad math is marked rather than breaking the page
