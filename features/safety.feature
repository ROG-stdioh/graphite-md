Feature: Rendering someone else's document
  A preview renders files you did not write, so it must not run them. Raw HTML
  renders — that is what GitHub does, and what VS Code's own Markdown preview
  does — and what makes that safe is not the renderer. The renderer decides what
  gets *rendered*; the Content Security Policy on the page the webview loads
  decides what gets *run*. So both halves are asserted here, because either one
  alone proves nothing: markup that arrives escaped is not a defence, it is the
  rendering bug this release exists to fix, and markup that arrives live under a
  policy that would execute it is the actual danger.

  The policy is asserted through src/webviewHtml.ts — the module that builds the
  page — rather than against a copy of the string, so what is checked is the
  policy that ships.

  Scenario: A script tag in a document cannot run
    Given a markdown document:
      """
      <script>document.body.textContent = 'pwned'</script>
      """
    When the preview renders it
    Then the script element is passed through as markup
    And the page allows scripts only from a nonce it issued itself

  Scenario: An inline event handler cannot run
    Given a markdown document:
      """
      <p onclick="document.body.textContent = 'pwned'">click me</p>
      """
    When the preview renders it
    Then the onclick attribute is passed through as markup
    And the page allows scripts only from a nonce it issued itself

  Scenario: An iframe cannot load
    Given a markdown document:
      """
      <iframe src="https://example.com"></iframe>
      """
    When the preview renders it
    Then the iframe element is passed through as markup
    And the page refuses every kind of content it has not named

  # The fourth of these, and the one that is not CSP: form-action does not fall
  # back to default-src, so the policy names it separately — and the host also
  # creates the panel with enableForms:false, which is the mechanism VS Code
  # uses. Panel options need a running editor to observe, so what is asserted
  # here is the half that is a string.
  Scenario: A form cannot submit
    Given a markdown document:
      """
      <form action="https://example.com/submit"><input type="text"></form>
      """
    When the preview renders it
    Then the form element is passed through as markup
    And the page refuses to post a form anywhere

  # A comment is the universal "hide this" convention in both Markdown and HTML.
  # It used to be stripped from the source before parsing, because with raw HTML
  # off a comment rendered as visible escaped text. With raw HTML on it arrives
  # as a real comment and the browser hides it the same way — and the source is
  # no longer rewritten on the way in, which is what the task-list feature
  # depends on for its line numbers.
  Scenario: A comment is hidden by the browser rather than stripped
    Given a markdown document:
      """
      Before <!-- an internal note --> after.
      """
    When the preview renders it
    Then the comment saying "an internal note" reaches the page as a real comment

  # A `<video>` written in raw HTML is a source out of the document exactly as a
  # picture is, so it crosses the same boundary and answers to the same setting.
  # What this catches is the policy admitting media from anywhere while remote
  # images are off — a directive added for parity that quietly widened the one
  # thing the setting exists to narrow.
  Scenario: Media from the network is refused while remote images are off
    Given a markdown document:
      """
      <video src="https://example.com/clip.mp4" controls></video>
      """
    When the preview renders it
    Then the page loads media from nowhere but itself

  # A nonce that never changed would be a constant with extra steps, and every
  # scenario above would still pass. This is what makes the nonce a nonce.
  Scenario: The nonce is fresh on every page
    Given a markdown document "hello"
    When the preview renders it
    Then two builds of the page are signed with different nonces
