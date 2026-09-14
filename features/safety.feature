Feature: Rendering someone else's document
  A preview renders files you did not write, so it must not run them. Raw HTML
  is shown rather than executed — with one exception, because HTML comments
  are the universal "hide this" convention in both Markdown and HTML.

  Scenario: A script tag is shown rather than run
    Given a markdown document "<script>alert(1)</script>"
    When the preview renders it
    Then the script tag is shown as text, not run

  Scenario: An HTML comment disappears
    Given a markdown document "Before <!-- an internal note --> after."
    When the preview renders it
    Then the comment disappears from the preview
