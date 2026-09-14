Feature: Math
  Math is typeset properly, whether it sits in a sentence or on its own line.
  The renderer is bundled with the extension, so none of this needs a network
  connection.

  Scenario: Math inside a sentence
    Given a markdown document "Euler's identity is $e^{i\pi}+1=0$ and it is famous."
    When the preview renders it
    Then the preview renders it as math

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

  Scenario: Malformed math is flagged instead of breaking the page
    Given a markdown document "Bad: $\frac{1}{$ here."
    When the preview renders it
    Then the render still produced a page
    Then the bad math is marked rather than breaking the page
