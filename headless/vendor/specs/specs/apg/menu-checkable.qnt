// WAI-ARIA APG — Menu: menuitemcheckbox / menuitemradio state.
//
// Pattern:  https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
//   - "Keyboard Interaction" > Enter: "Otherwise, activates the item and closes the
//     menu."
//   - "Keyboard Interaction" > Space: (Optional) on a menuitemcheckbox "changes the
//     state without closing the menu"; (Optional) on an unchecked menuitemradio
//     "checks the focused menuitemradio and unchecks any other checked
//     menuitemradio element in the same group" without closing; on a plain item
//     activates it and closes.
//   - "WAI-ARIA Roles, States, and Properties": aria-checked=true on a checked
//     menuitemcheckbox / menuitemradio; radio items grouped (separator-delimited).
// Example:  https://www.w3.org/WAI/ARIA/apg/patterns/menubar/examples/menubar-editor/
//           (Font > menuitemcheckbox Bold/Italic..., menuitemradio sizes/faces)
//
// Request vs commit (map ticket rt1p). Enter and Space on an item carry the
// intended checked state (`requested`, the checkbox bit and the radio choice
// packed with `checked`). A real request fires onCheckedChange / onValueChange
// (`requests` counts the calls) when the intent differs from the current state,
// and then:
//   uncontrolled        the request is accepted: the items commit the intent
//   controlled, holds   the host ignores it ("rejected"): the checked items stay
//   controlled, accepts the host answers with the same value (`accepting`): the
//                       checked items commit through the controlled value
// `valueProp` is the only thing that changes the checked items while
// `controlled`; `setValue` / `hostToggle` are the host writing it. `control` /
// `acceptRequests` are configuration events (init is literal-only). The open
// state is not part of the controlled value, so a rejected check still closes
// the menu as the key's open-state half dictates.
//
// Fixture (one menu opened from a trigger; 1-based, 0 = focus on the trigger):
//   1 menuitemcheckbox "Word wrap"      (state `wrap`)
//   2 menuitemradio "Small"  \
//   3 menuitemradio "Medium"  } one radio group (state `choice`, exactly one checked)
//   4 menuitemradio "Large"  /
//   5 menuitem "Reset view"            (plain)
//
// ARIA contract (derived defs): ariaChecked(i, wrap, choice) is the aria-checked
// value of item i (true/false for checkable roles; a plain item has none, reported
// false), itemRole(i) is the role code (0 menuitem | 1 menuitemcheckbox |
// 2 menuitemradio), isChecked(i, ...) is only meaningful for checkable roles.
//
// Deliberate omissions: navigation keys beyond Up/Down (+ wrap) and Home/End are
// covered by menu-menubar.qnt / menu-button.qnt; typeahead; disabled items; the
// activation of the plain item has no side effect besides closing; Space on the
// plain item closes (the "Optional" APG variant); pointer events.
module apg_menu_checkable {
  import aria.* from "../../shared/aria"

  var focusIdx: int      // 0 = on the trigger (menu closed), 1..5 = focused item
  var menuOpen: bool     // menu displayed
  var wrap: bool         // menuitemcheckbox 1 checked
  var choice: int        // checked radio of the group (2..4)
  var lastActivated: int // last activated item (0 none)
  var controlled: bool   // the host owns the checked items (`value` prop present)
  var accepting: bool    // controlled host that answers every request with its intent
  var valueProp: int     // the controlled checked state, packed with `checked`
  var requested: int     // intent of the last request, packed
  var outcome: str       // "none" | "accepted" | "rejected"
  var base: int          // checked state when the last request was received, packed
  var requests: int      // number of requests that fired a change callback

  def itemRole(i: int): int =
    if (i == 1) 1 else if (and(i >= 2, i <= 4)) 2 else 0
  def ariaChecked(i: int, w: bool, c: int): bool =
    if (i == 1) w else if (and(i >= 2, i <= 4)) c == i else false
  def b2i(b: bool): int = if (b) 1 else 0
  def isRadio(i: int): bool = itemRole(i) == 2

  // request / commit (map ticket rt1p)
  // injective: checkbox bit * 5 + radio choice (2..4)
  def checked(w: bool, c: int): int = b2i(w) * 5 + c
  def nowPacked: int = checked(wrap, choice)
  def wrapFrom(v: int): bool = v >= 5
  def choiceFrom(v: int): int = v % 5
  def holds: bool = and(controlled, not(accepting))
  def follows: bool = and(controlled, accepting)
  def verdict: str = if (holds) "rejected" else "accepted"
  def propAfter(f: bool, p: int, want: int): int = if (f) want else p
  // the intended checked state of an activation (Enter / Space on an item)
  def intentWrap: bool = if (and(menuOpen, focusIdx == 1)) not(wrap) else wrap
  def intentChoice: int = if (and(menuOpen, isRadio(focusIdx))) focusIdx else choice
  def intentPacked: int = checked(intentWrap, intentChoice)
  def checkedMoves: bool = intentPacked != nowPacked
  // a held request with a moving check is rejected: the checked items stay put
  def rejects: bool = and(holds, checkedMoves)

  action init = all {
    focusIdx' = 0,
    menuOpen' = false,
    wrap' = false,
    choice' = 2,
    lastActivated' = 0,
    controlled' = false,
    accepting' = false,
    valueProp' = 2,
    requested' = 2,
    outcome' = "none",
    base' = 2,
    requests' = 0
  }

  action arrow_down = all {
    focusIdx' = if (menuOpen) ariaWrapNext1(focusIdx, 5) else 1,
    menuOpen' = true,
    wrap' = wrap,
    choice' = choice,
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  action arrow_up = all {
    focusIdx' = if (menuOpen) ariaWrapPrev1(focusIdx, 5) else 5,
    menuOpen' = true,
    wrap' = wrap,
    choice' = choice,
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  action key_home = all {
    focusIdx' = if (menuOpen) 1 else focusIdx,
    menuOpen' = menuOpen,
    wrap' = wrap,
    choice' = choice,
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  action key_end = all {
    focusIdx' = if (menuOpen) 5 else focusIdx,
    menuOpen' = menuOpen,
    wrap' = wrap,
    choice' = choice,
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  // request: Enter on the trigger opens on the first item; on an item changes its
  // state (toggle a checkbox, check a radio) AND closes the menu
  action enter = all {
    focusIdx' = if (menuOpen) 0 else 1,
    menuOpen' = not(menuOpen),
    wrap' = if (rejects) wrap else intentWrap,
    choice' = if (rejects) choice else intentChoice,
    lastActivated' = if (menuOpen) focusIdx else lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = propAfter(follows, valueProp, intentPacked),
    requested' = if (checkedMoves) intentPacked else requested,
    outcome' = if (checkedMoves) verdict else outcome,
    base' = if (checkedMoves) nowPacked else base,
    requests' = if (checkedMoves) requests + 1 else requests
  }

  // request: Space on the trigger opens; on a checkbox / radio changes the state
  // WITHOUT closing; on the plain item activates and closes
  action space = all {
    focusIdx' = if (not(menuOpen)) 1 else if (focusIdx == 5) 0 else focusIdx,
    menuOpen' = if (not(menuOpen)) true else if (focusIdx == 5) false else true,
    wrap' = if (rejects) wrap else intentWrap,
    choice' = if (rejects) choice else intentChoice,
    lastActivated' = if (menuOpen) focusIdx else lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = propAfter(follows, valueProp, intentPacked),
    requested' = if (checkedMoves) intentPacked else requested,
    outcome' = if (checkedMoves) verdict else outcome,
    base' = if (checkedMoves) nowPacked else base,
    requests' = if (checkedMoves) requests + 1 else requests
  }

  action escape = all {
    focusIdx' = if (menuOpen) 0 else focusIdx,
    menuOpen' = false,
    wrap' = wrap,
    choice' = choice,
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  // commit: the host writes the controlled checked state (a no-op while uncontrolled)
  action setValue = {
    nondet v = Set(2, 3, 4, 7, 8, 9).oneOf()
    all {
      focusIdx' = focusIdx,
      menuOpen' = menuOpen,
      wrap' = if (controlled) wrapFrom(v) else wrap,
      choice' = if (controlled) choiceFrom(v) else choice,
      lastActivated' = lastActivated,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = if (controlled) v else valueProp,
      requested' = requested,
      outcome' = if (controlled) "none" else outcome,
      base' = base,
      requests' = requests
    }
  }

  // commit: the host flips the checkbox item of its own copy of the state
  action hostToggle = all {
    focusIdx' = focusIdx,
    menuOpen' = menuOpen,
    wrap' = if (controlled) not(wrap) else wrap,
    choice' = choice,
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = if (controlled) checked(not(wrap), choice) else valueProp,
    requested' = requested,
    outcome' = if (controlled) "none" else outcome,
    base' = base,
    requests' = requests
  }

  // configuration: the host starts owning the checked items, adopting the current ones
  action control = all {
    focusIdx' = focusIdx,
    menuOpen' = menuOpen,
    wrap' = wrap,
    choice' = choice,
    lastActivated' = lastActivated,
    controlled' = true,
    accepting' = accepting,
    valueProp' = nowPacked,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  // configuration: the controlled host answers every request with its intent
  action acceptRequests = all {
    focusIdx' = focusIdx,
    menuOpen' = menuOpen,
    wrap' = wrap,
    choice' = choice,
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = true,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  action step = any {
    init, arrow_down, arrow_up, key_home, key_end, enter, space, escape,
    setValue, hostToggle, control, acceptRequests
  }

  val FocusIdxInRange: bool = and(focusIdx >= 0, focusIdx <= 5)
  // the menu is open exactly while focus is on one of its items
  val OpenIffFocusInMenu: bool = menuOpen == (focusIdx > 0)
  val RadioChoiceInGroup: bool = and(choice >= 2, choice <= 4)
  // a radio group always has exactly one aria-checked=true member (cannot be unchecked)
  val ExactlyOneRadioChecked: bool =
    b2i(ariaChecked(2, wrap, choice)) + b2i(ariaChecked(3, wrap, choice)) + b2i(ariaChecked(4, wrap, choice)) == 1
  // the checkbox's aria-checked is its own state, independent of the radio group
  val CheckboxCheckedIsWrap: bool = ariaChecked(1, wrap, choice) == wrap
  // the plain item never carries aria-checked=true
  val PlainItemNeverChecked: bool = not(ariaChecked(5, wrap, choice))
  val LastActivatedValid: bool = and(lastActivated >= 0, lastActivated <= 5)
  // callbacks only ever count up from zero
  val RequestsNonNegative: bool = requests >= 0
  // controlled: only the value prop sets the checked items, so no event commits
  val ControlledFollowsProp: bool = or(not(controlled), nowPacked == valueProp)
  // a rejected request leaves the checked items as it found them
  val RejectedRequestUntouched: bool = or(not(outcome == "rejected"), nowPacked == base)
  // an accepted request committed exactly its intent
  val AcceptedRequestCommits: bool = or(not(outcome == "accepted"), nowPacked == requested)
}
