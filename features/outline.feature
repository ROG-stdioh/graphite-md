Feature: The outline pane
  The pane beside the preview lists a document's structure three ways —
  Content, Tables and Diagrams. Everything in it is clickable, so everything
  in it has to point somewhere real.

  Background:
    Given a markdown document:
      """
      # Quorum Latency

      ## Model

      We consider a stream replicated across nodes.

      | State  | Latency |
      |--------|---------|
      | Healthy| T_f     |

      | State   | Probability |
      |---------|-------------|
      | Slow    | p           |

      ## Measurement

      ```mermaid
      graph TD;
        A-->B;
      ```

      ## Results

      Nothing here yet.
      """
    When the preview renders it

  Scenario: The Content view follows the document's own nesting
    Then the outline reads:
      | section     | depth |
      | Model       | 0     |
      | Measurement | 0     |
      | Results     | 0     |

  Scenario: A table is filed under the section it appears in
    Then the outline lists 2 tables
    Then the outline lists a table named "Model — table 1"
    Then the outline lists a table named "Model — table 2"

  Scenario: A diagram is filed under the section it appears in
    Then the outline lists 1 diagrams
    Then the outline lists a diagram named "Measurement"

  Scenario: Every entry in the outline can be clicked
    Then every outline entry points at something in the document
    Then every outline table points at a table in the document

  Scenario: A table written before the first heading belongs to no section
    Given a markdown document:
      """
      | A |
      |---|
      | 1 |

      ## Later
      """
    When the preview renders it
    Then the outline lists 0 tables
    Then the outline reads:
      | section | depth |
      | Later   | 0     |
