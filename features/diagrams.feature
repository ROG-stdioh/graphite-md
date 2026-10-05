Feature: Diagrams
  A fenced mermaid block is drawn rather than printed. Like the maths, mermaid
  ships inside the extension.

  Scenario: A mermaid fence becomes a diagram
    Given a markdown document:
      """
      ## Flow

      ```mermaid
      graph TD;
        Coordinator-->Replica;
      ```
      """
    When the preview renders it
    Then the preview renders a diagram

  Scenario: The diagram is handed its source to draw
    Given a markdown document:
      """
      ## Flow

      ```mermaid
      graph TD;
        Coordinator-->Replica;
      ```
      """
    When the preview renders it
    Then the diagram is handed its source to draw

  Scenario: A diagram sits in the section it was written in
    Given a markdown document:
      """
      ## Flow

      ```mermaid
      graph TD;
        A-->B;
      ```
      """
    When the preview renders it
    Then the outline lists a diagram named "Flow"

  # A diagram above the first heading. Nothing requires an author to write a
  # heading first, and the intro is rendered down a different path from a
  # section body — one that did not run the scan that names diagrams. The id was
  # written and collected by nothing, so the pane listed no diagram and, because
  # the script is loaded only when there is one to draw, the reader got the
  # fence's own source on the page instead of the drawing.
  Scenario: A diagram above the first heading is still a diagram
    Given a markdown document:
      """
      # Runbook

      ```mermaid
      graph TD;
        A-->B;
      ```
      """
    When the preview renders it
    Then the preview renders a diagram
    And the outline lists a diagram named "Runbook"

  # The same document with no heading of any kind in it. There is no title to
  # name the entry after, so it needs a name of its own rather than an empty
  # one — and this is the case a document of nothing but a diagram and a
  # paragraph hits.
  Scenario: A diagram above every heading is named for the document
    Given a markdown document:
      """
      ```mermaid
      graph TD;
        A-->B;
      ```
      """
    When the preview renders it
    Then the outline lists a diagram named "Introduction"

  Scenario: Other fenced blocks are not treated as diagrams
    Given a markdown document:
      """
      ## Code

      ```js
      const a = 1;
      ```
      """
    When the preview renders it
    Then the outline lists 0 diagrams
