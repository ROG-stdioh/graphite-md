Feature: Images
  A markdown preview that cannot show a picture is missing one of the first
  things anyone tries. Every `![alt](src)` used to render an `<img>` whose
  source pointed at nothing: the renderer is a pure string function with no idea
  where the document lives, and a relative URL inside a webview resolves against
  the *webview's* origin rather than the document's folder.

  The renderer cannot resolve a source itself, so the host lends it a resolver
  through the render environment. The scenarios below hold the renderer to that
  contract; the host's own half — deciding which sources it will resolve at all
  — is pure logic in src/sourceRef.ts, checked under its own heading.

  Scenario: With no host resolver, a source is emitted as written
    Given a markdown document:
      """
      ![a sibling file](diagram.png)
      """
    When the preview renders it
    Then the image is loaded from "diagram.png"

  Scenario: The host is offered the source exactly as the author wrote it
    Given the host resolves image sources
    And a markdown document:
      """
      ![a sibling file](diagram.png)
      """
    When the preview renders it
    Then the host was asked to resolve "diagram.png"
    And the image is loaded from "resolved:diagram.png"

  Scenario: A source the host declines is left exactly as written
    Given the host refuses every image source
    And a markdown document:
      """
      ![a remote image](https://example.com/x.png)
      """
    When the preview renders it
    Then the image is loaded from "https://example.com/x.png"

  Scenario: Every image is offered, not only the first
    Given the host resolves image sources
    And a markdown document:
      """
      ![one](one.png)

      ![two](two.png)
      """
    When the preview renders it
    Then the host was asked to resolve "one.png"
    And the host was asked to resolve "two.png"

  Scenario: The alt text survives the rewrite
    Given the host resolves image sources
    And a markdown document:
      """
      ![a sibling file](diagram.png)
      """
    When the preview renders it
    Then the image is described as "a sibling file"

  # ---- what the host decides a source even is ------------------------------
  # extension.ts cannot be loaded without a running VS Code, so the decision it
  # makes about a source lives in src/sourceRef.ts, where it can be checked
  # without one. "none" is the table's word for an absent value — a scheme that
  # isn't there, a fragment that isn't there — because an empty cell would not
  # bind to the step's parameter at all.

  Scenario Outline: A scheme is reported only when the author named one
    Given the source "<source>"
    Then its scheme is "<scheme>"

    Examples:
      | source                     | scheme |
      | diagram.png                | none   |
      | ./images/shot.png          | none   |
      | ../shared/logo.png         | none   |
      | /assets/x.png              | none   |
      | images/a b.png             | none   |
      | https://example.com/x.png  | https: |
      | http://example.com/x.png   | http:  |
      | data:image/png;base64,AAAA | data:  |
      | file:///c:/pics/x.png      | file:  |
      | HTTPS://EXAMPLE.COM/x.png  | https: |
      | C:\pics\x.png              | c:     |

  Scenario Outline: A fragment comes off a path and stays on a scheme
    Given the source "<source>"
    Then its path is "<path>"
    And its fragment is "<fragment>"

    Examples:
      | source                      | path                        | fragment |
      | diagram.png                 | diagram.png                 | none     |
      | diagram.png#anchor          | diagram.png                 | anchor   |
      | ./a/b.png#one#two           | ./a/b.png                   | one#two  |
      | #just-a-fragment            | none                        | just-a-fragment |
      | data:image/png;base64,AA#B  | data:image/png;base64,AA#B  | none     |
      | https://example.com/x#frag  | https://example.com/x#frag  | none     |

  Scenario Outline: A leading slash is recorded, not interpreted
    Given the source "<source>"
    Then the path <begins>

    Examples:
      | source                | begins                      |
      | /assets/x.png         | begins with a slash         |
      | /assets/x.png#anchor  | begins with a slash         |
      | //example.com/x.png   | begins with a slash         |
      | images/x.png          | does not begin with a slash |
      | ./images/x.png        | does not begin with a slash |
      | ../shared/logo.png    | does not begin with a slash |
      | https://example.com/x | does not begin with a slash |
      | C:\pics\x.png         | does not begin with a slash |
      | diagram.png#anchor    | does not begin with a slash |

  # The rules below are VS Code's own, read off its Markdown preview rather than
  # invented. A preview that resolves a path differently from the editor beside
  # it is a preview that shows a picture the editor says is missing, so where
  # there was a choice, the choice was to agree with the editor.

  Scenario Outline: The host decides which base a source is read from
    Given the document is <where>
    And the source "<source>"
    Then the plan is "<plan>"

    Examples:
      | source                     | where        | plan                        |
      | images/x.png               | in a folder  | document:images/x.png       |
      | images/x.png               | in no folder | document:images/x.png       |
      | ../shared/logo.png         | in a folder  | document:../shared/logo.png |
      | /assets/x.png              | in a folder  | folder:/assets/x.png        |
      | /assets/x.png              | in no folder | document:/assets/x.png      |
      | images/a%20b.png           | in a folder  | document:images/a b.png     |
      | images/a%2.png             | in a folder  | document:images/a%2.png     |

  Scenario Outline: A source the host will not read is refused, not rewritten
    Given the document is in a folder
    And the source "<source>"
    Then the plan is "refuse"

    Examples:
      | source                     |
      | https://example.com/x.png  |
      | http://example.com/x.png   |
      | data:image/png;base64,AAAA |
      | C:\pics\x.png              |
      | #just-a-fragment           |

  Scenario Outline: A file: URI is an address, not a path to resolve
    Given the document is <where>
    And the source "<source>"
    Then the plan is "<plan>"

    Examples:
      | source                       | where        | plan                             |
      | file:///c:/pics/x.png        | in a folder  | uri:file:///c:/pics/x.png        |
      | file:///c:/pics/x.png        | in no folder | uri:file:///c:/pics/x.png        |
      | file:///c:/work/a b/x.png    | in a folder  | uri:file:///c:/work/a b/x.png    |
