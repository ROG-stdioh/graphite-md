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

  # A <table> written in raw HTML has no token of its own to hang an id on, so
  # for a long time it rendered correctly and appeared in no view at all:
  # visible on the page, absent from the pane that exists to list it, and with
  # nothing in the log to say so.
  Scenario: A table written in raw HTML joins the Tables view
    Given a markdown document:
      """
      ## Costs

      <table>
        <tr><td>Markdown parse</td><td>5.5 ms</td></tr>
      </table>
      """
    When the preview renders it
    Then the outline lists 1 tables
    Then the outline lists a table named "Costs"
    Then every outline table points at a table in the document

  # The id is assigned by one scan over the finished HTML rather than by the
  # renderer as it goes, and this is the case that says why. A section holding
  # both syntaxes is where the two orders disagree: numbering in render order
  # would put the Markdown table first whatever order they were written in, and
  # the pane would list them backwards.
  Scenario: Both syntaxes in one section are numbered in document order
    Given a markdown document:
      """
      ## Costs

      <table>
        <tr><td>hand</td><td>written</td></tr>
      </table>

      | Stage | Cost |
      |-------|------|
      | parse | 5 ms |
      """
    When the preview renders it
    Then the tables read:
      | table           | target  |
      | Costs — table 1 | table-1 |
      | Costs — table 2 | table-2 |

  # The id a document writes is the anchor it can link to, so the pane has to
  # target that name rather than one invented for it — and the scan must replace
  # an id it finds rather than add a second one beside it.
  Scenario: A table the document named keeps that name
    Given a markdown document:
      """
      ## Costs

      <table id="totals">
        <tr><td>a</td></tr>
      </table>
      """
    When the preview renders it
    Then the outline lists a table at "totals"
    Then every outline table points at a table in the document
    Then no two elements share an id

  # The same table under a heading that already answers to that name. The
  # heading keeps the bare slug, because that is the anchor every other Markdown
  # renderer produces for `## Totals` and the one a reader's own links point at;
  # the table moves to the next free name rather than the two of them sharing
  # one, which would send every link to `#totals` to whichever came first.
  Scenario: A named table that collides with its heading's anchor is moved
    Given a markdown document:
      """
      ## Totals

      <table id="totals">
        <tr><td>a</td></tr>
      </table>
      """
    When the preview renders it
    Then the outline lists a table at "totals-1"
    Then every outline table points at a table in the document
    Then no two elements share an id

  # The scan is a pattern over rendered HTML, so the way it goes wrong is
  # matching text that only looks like markup. A document about HTML has to be
  # able to show a <table> without the pane quietly gaining an entry for it.
  Scenario: A table shown as code is not listed
    Given a markdown document:
      """
      ## Showing

      ```
      <table>
        <tr><td>example</td></tr>
      </table>
      ```
      """
    When the preview renders it
    Then the outline lists 0 tables

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
