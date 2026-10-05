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

  # How the fold is drawn, as the page receives it. The pane is either given a
  # width transition or taken out of the layout outright, and both of those are
  # CSS — so the page's half of the setting is the attribute the stylesheet
  # switches on, and this says a name the two sides disagree about, or a default
  # that never reached the body, fails somewhere rather than nowhere.
  Scenario: The fold is animated unless the reader turns it off
    Given a markdown document "hello"
    When the preview renders it
    Then the page animates the fold

  Scenario: The fold is instant when the setting is off
    Given the animation setting is off
    And a markdown document "hello"
    When the preview renders it
    Then the page does not animate the fold

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
    # The control: the table *is* on the page, as code, which is the only reason
    # its absence from the pane means anything. Without this line the scenario
    # passes for a document that rendered nothing at all.
    And the code shows the literal text "<table>"

  # The intro — everything above the first heading — is not a section, and the
  # first assertion below is the one this scenario was written for: nothing up
  # there gets a row in the Content view.
  #
  # The second assertion is the correction. "No section" had been read as "no
  # entry anywhere", so a table written above the first heading was listed in no
  # view at all — the renderer only scanned section bodies, and the test agreed
  # with it. The Tables view is a flat list of where things are in the document
  # and the intro is a place in it; with no heading to file it under, the entry
  # is named for the document's own title, which is the heading that text sits
  # beneath on the page.
  Scenario: A table written before the first heading is listed, and is no section
    Given a markdown document:
      """
      # Report

      | A |
      |---|
      | 1 |

      ## Later
      """
    When the preview renders it
    Then the outline lists 1 tables
    Then the outline lists a table named "Report"
    Then every outline table points at a table in the document
    Then the outline reads:
      | section | depth |
      | Later   | 0     |

  # Where the intro's scan sits is the whole of this scenario. The ids come off
  # one counter, allocated in the order the scans run, and both views are in
  # document order — so a scan placed after the sections would list the table at
  # the top of the document below the one under `## Later`, and hand them the
  # ids the wrong way round while it was there.
  Scenario: An intro table and a section table are numbered in document order
    Given a markdown document:
      """
      # Report

      | Stage | Cost |
      |-------|------|
      | parse | 5 ms |

      ## Detail

      | Stage | Cost |
      |-------|------|
      | lex   | 2 ms |
      """
    When the preview renders it
    Then the tables read:
      | table   | target  |
      | Report  | table-1 |
      | Detail  | table-2 |
