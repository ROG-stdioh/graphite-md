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
