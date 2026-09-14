Feature: Code blocks
  Code is highlighted when the language is known, and shown plainly when it
  isn't. A fence the highlighter has never heard of must not cost you the code
  inside it.

  Scenario: A fenced block with a known language is highlighted
    Given a markdown document:
      """
      ```js
      const a = 1;
      ```
      """
    When the preview renders it
    Then the code is syntax highlighted

  Scenario: A block with an unknown language is shown plainly
    Given a markdown document:
      """
      ```not-a-language
      something
      ```
      """
    When the preview renders it
    Then the code is shown without highlighting
    Then the code shows the literal text "something"

  Scenario: A block with no language is shown plainly
    Given a markdown document:
      """
      ```
      npm install graphite-md
      ```
      """
    When the preview renders it
    Then the code is shown without highlighting
    Then the code shows the literal text "npm install graphite-md"

  Scenario: Angle brackets in code are shown, not parsed as HTML
    Given a markdown document:
      """
      ```not-a-language
      <angle brackets>
      ```
      """
    When the preview renders it
    Then the code shows the literal text "<angle brackets>"
