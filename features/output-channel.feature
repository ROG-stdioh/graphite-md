Feature: The extension's own log
  The output channel is what a user reads when the preview misbehaves, so what
  goes into it has to be worth reading and safe to read. A failure arrives with
  its stack still attached to the sentence explaining it, and anything that came
  out of the document arrives as one bounded line — because a message that can
  carry a line break can forge an entry that reads as the extension saying
  something it never said, and a log a reader cannot trust is worse than no log.

  Scenario: A failure with no cause is the message by itself
    Given a log message "failed to render" with no cause
    Then the log line is "failed to render"

  Scenario: A failure keeps its stack attached to the sentence explaining it
    Given a log message "failed to render" with an Error cause saying "boom"
    Then the log line starts with "failed to render: Error: boom"
    And the log line still carries the stack

  Scenario: A plain string cause is appended
    Given a log message "failed to open" with a cause of "no such file"
    Then the log line is "failed to open: no such file"

  Scenario: A cause with nothing to serialise still names what arrived
    Given a log message "failed" with a cause that is a function
    Then the log line starts with "failed: [object Function]"

  Scenario: A cause that cannot be serialised costs only its own detail
    Given a log message "failed" with a cause that refers to itself
    Then the log line is "failed: (unserialisable)"

  # Docstrings rather than the inline {string} form, and not for readability:
  # Cucumber does not unescape \n inside {string} — it arrives as a literal
  # backslash — so a docstring is the only way to write a real line break here.
  Scenario: A message from the webview arrives as one line
    Given a webview message:
      """
      one
      two
      """
    Then the bounded line is "one two"

  Scenario: A message from the webview cannot forge a log entry
    Given a webview message:
      """
      rendered fine
      failed to render document
      """
    Then the bounded line is "rendered fine failed to render document"

  Scenario: A long message from the webview is cut short
    Given a webview message of 5000 characters
    Then the bounded line is shorter than the message
    And the bounded line ends with "… (truncated)"

  Scenario: A message that fits is left exactly as written
    Given a webview message "diagram failed to render"
    Then the bounded line is "diagram failed to render"
