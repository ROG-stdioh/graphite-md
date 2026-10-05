Feature: Entities and escaping
  Raw HTML is on, so the renderer's escaping is the only thing standing between
  a document's text and the page's structure. Two directions, and they fail
  apart: text that should reach the page as characters must not become markup,
  and characters that should reach it literally must not be mangled on the way.

  Neither had a scenario, and the reason is in the assertion the suite had. The
  step every content scenario used reads `textContent`, and `textContent` decodes
  entities and drops markup — so `<b>` as text and `<b>` as an element are the
  same string to it, and `&` and `&amp;` are the same character. These scenarios
  read the tree instead.

  # The positive control is inside the scenario, and it is the whole point: the
  # same three characters are live markup in the prose and dead text in the code
  # span, on one page, in one render. A rule that escaped everything, or escaped
  # in the wrong place, moves exactly one of the two counts.
  Scenario: The same markup is an element in prose and text in a code span
    Given a markdown document "Real <b>bold</b> markup, and `<i>not italic</i>` in a code span."
    When the preview renders it
    Then the preview shows 1 b element
    And the preview shows 0 i elements
    And the preview shows the text "<i>not italic</i>"

  # A fence, where the escaping is not the renderer's own: highlight.js rewrites
  # the block into spans and escapes what it writes. The count is what makes the
  # claim — a `<b>` outside the fence is there to be found, so "no `<b>` at all"
  # cannot be reached by the fence being dropped.
  Scenario: A fenced block shows its markup as text
    Given a markdown document:
      """
      ```html
      <b>bold</b>
      ```

      Real <b>bold</b> markup outside the fence.
      """
    When the preview renders it
    Then the preview shows 1 b element
    And the code shows the literal text "<b>bold</b>"

  # A named entity is a character reference, not decoration: the source names a
  # character and the reader sees that character. Asserted exactly, because the
  # failure is an extra escaping pass — `&amp;` written through twice reaches the
  # page as the five characters `&amp;`, which contains the `&` a containment
  # test would have asked for.
  Scenario: A named entity reaches the page as the character it names
    Given a markdown document "Write &copy; for the sign and &amp; for an ampersand."
    When the preview renders it
    Then the preview's text is exactly "Write © for the sign and & for an ampersand."

  # A bare ampersand, which is not an entity and must survive as one character.
  # It is the case that breaks when the escaping is done by hand rather than by
  # the parser: `&D` and `&T` are not references, so a renderer that left them
  # alone passes — and the same renderer turns `&copy;` into © by accident.
  Scenario: A bare ampersand stays an ampersand
    Given a markdown document "R&D and AT&T."
    When the preview renders it
    Then the preview's text is exactly "R&D and AT&T."
