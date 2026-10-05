Feature: Links
  In a Markdown preview, "README.md" is overwhelmingly a filename. Linkifying
  it turns a document that merely mentions a file into a link to a website
  somebody else owns — plenty of country domains are also file extensions.

  # Each of the three below carries a link that *should* be made, in the same
  # document. Without it the scenario is an absence, and a renderer that stopped
  # linkifying altogether — the one failure that would matter — passes all
  # three. With it, the scenario says the rule is discriminating rather than
  # off: the bare token stays text and the explicit URL beside it does not.
  Scenario: A filename is not turned into a link
    Given a markdown document "See README.md for the details, or read https://example.com/docs today."
    When the preview renders it
    Then "README.md" is not turned into a link
    And "https://example.com/docs" is a link to "https://example.com/docs"

  Scenario: A shell script name is not turned into a link
    Given a markdown document "Run setup.sh first, or read https://example.com/docs if it fails."
    When the preview renders it
    Then "setup.sh" is not turned into a link
    And "https://example.com/docs" is a link to "https://example.com/docs"

  Scenario: A bare domain is not turned into a link
    Given a markdown document "More at example.com if you want it, or read https://example.com/docs for the rest."
    When the preview renders it
    Then "example.com" is not turned into a link
    And "https://example.com/docs" is a link to "https://example.com/docs"

  Scenario: An explicit URL is still a link
    Given a markdown document "Read https://example.com/docs today."
    When the preview renders it
    Then "https://example.com/docs" is a link to "https://example.com/docs"

  Scenario: An email address is still a link
    Given a markdown document "Write to ops@example.com about it."
    When the preview renders it
    Then "ops@example.com" is an email link

  Scenario: A relative link written by hand survives
    Given a markdown document "See [the runbook](runbook.md) for more."
    When the preview renders it
    Then "the runbook" is a link to "runbook.md"
