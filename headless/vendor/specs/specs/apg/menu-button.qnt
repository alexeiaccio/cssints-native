// WAI-ARIA APG — Menu Button: a button that opens a (flat) menu.
//
// Pattern:  https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/
//   - "Keyboard Interaction": with focus on the button Enter / Space open the menu
//     on the first item, (optional) Down Arrow opens on the first item, (optional)
//     Up Arrow opens on the last item.
//   - "WAI-ARIA Roles, States, and Properties": the button has aria-haspopup and
//     aria-expanded true/false.
//   Once open, the menu behaves as in https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
//   (Keyboard Interaction): Down/Up wrap, Home/End, typeahead, Enter/Space activate
//   and close, Escape closes and returns focus to the button, Tab closes and leaves,
//   Left/Right Arrow do nothing without a menubar (modelled by absence of events).
// Examples: https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/examples/menu-button-actions/
//           https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/examples/menu-button-actions-active-descendant/
//           https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/examples/menu-button-links/
//
// Request vs commit (map ticket rt1p). Every event a user sees as an open/close —
// tab_out, click_button, activate, arrow_down, arrow_up, escape — is a *request*
// carrying the intended open state (`requested`); it fires onOpenChange
// (`requests` counts the calls) when the intent differs from the current state,
// and then:
//   uncontrolled        the request is accepted: the whole transition commits
//   controlled, holds   the host ignores it ("rejected"): nothing moves
//   controlled, accepts the host answers with the same value (`accepting`): the
//                       transition commits through the controlled value
// `valueProp` is the only thing that changes `menuOpen` while `controlled`;
// `setValue` / `hostToggle` are the host writing it. `control` / `acceptRequests`
// are configuration events (init is literal-only). A rejected request reverts
// the *whole* transition (focus included), so the ARIA invariants still hold.
//
// Fixture: 4 items, item 3 is aria-disabled ("focusable but cannot be activated",
// APG note 1). Typeahead label codes: item1=1, item2=2, item3=1, item4=2.
//
// Focus is `(focusLevel, focusIdx)`: 0 outside, 1 on the button, 2 on a menu item.
//
// ARIA contract (derived defs): ariaExpanded(open), ariaHasPopup,
// ariaActiveDescendant(level, idx) (the item id an activedescendant implementation
// would expose; the element.focus() variant uses focusIdx directly), ariaDisabled(i).
//
// Deliberate omissions: Shift+Tab is `tab_out` as Tab; no hover/pointer-leave; the
// menu container is not itself focusable; no menu-button-links navigation (an
// activation is a recorded item index); no aria-controls id (a static relation);
// activating while a disabled item is focused is a no-op (menu stays open);
// typeahead is a no-op while the menu is closed; letters are one-letter codes 1..3.
module apg_menu_button {
  import aria.* from "../../shared/aria"

  var focusLevel: int    // 0 outside | 1 button | 2 menu item
  var focusIdx: int      // focused menu item (0 unless focusLevel == 2)
  var menuOpen: bool     // the menu is displayed (button aria-expanded)
  var lastActivated: int // last activated item (0 none)
  var controlled: bool   // the host owns `menuOpen` (`value` prop present)
  var accepting: bool    // controlled host that answers every request with its intent
  var valueProp: bool    // the controlled open value (meaningful while controlled)
  var requested: bool    // intent of the last request
  var outcome: str       // "none" | "accepted" | "rejected"
  var base: bool         // open state when the last request was received
  var requests: int      // number of requests that fired onOpenChange

  def isDisabled(i: int): bool = i == 3
  def letterOf(i: int): int = if (i == 1) 1 else if (i == 2) 2 else if (i == 3) 1 else 2
  def c1(i: int): int = ariaWrapNext1(i, 4)
  def typeTarget(i: int, ch: int): int =
    if (letterOf(c1(i)) == ch) c1(i)
    else if (letterOf(c1(c1(i))) == ch) c1(c1(i))
    else if (letterOf(c1(c1(c1(i)))) == ch) c1(c1(c1(i)))
    else i

  // ARIA contract
  def ariaExpanded(open: bool): bool = open
  def ariaHasPopup(open: bool): bool = true
  def ariaDisabled(i: int): bool = isDisabled(i)
  def ariaActiveDescendant(l: int, i: int): int = if (l == 2) i else 0

  // request / commit (map ticket rt1p)
  def holds: bool = and(controlled, not(accepting))
  def follows: bool = and(controlled, accepting)
  def verdict: str = if (holds) "rejected" else "accepted"
  def landed(h: bool, cur: bool, want: bool): bool = if (h) cur else want
  def propAfter(f: bool, p: bool, want: bool): bool = if (f) want else p
  // the intended open state of each request
  def activateWant: bool =
    if (focusLevel == 1) true
    else if (and(focusLevel == 2, not(isDisabled(focusIdx)))) false
    else menuOpen
  def downWant: bool = if (focusLevel == 1) true else menuOpen
  def escapeWant: bool = if (focusLevel == 2) false else menuOpen
  // a request is real only when its intent differs from the current state
  def moves(want: bool): bool = want != menuOpen
  // a held request with a moving intent is rejected: the whole transition reverts
  def rejects(want: bool): bool = and(holds, moves(want))

  action init = all {
    focusLevel' = 0,
    focusIdx' = 0,
    menuOpen' = false,
    lastActivated' = 0,
    controlled' = false,
    accepting' = false,
    valueProp' = false,
    requested' = false,
    outcome' = "none",
    base' = false,
    requests' = 0
  }

  // Tab onto the button
  action focus_in = all {
    focusLevel' = if (focusLevel == 0) 1 else focusLevel,
    focusIdx' = focusIdx,
    menuOpen' = menuOpen,
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  // request: Tab / Shift+Tab / blur closes and leaves
  action tab_out = all {
    focusLevel' = if (rejects(false)) focusLevel else 0,
    focusIdx' = if (rejects(false)) focusIdx else 0,
    menuOpen' = landed(holds, menuOpen, false),
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = propAfter(follows, valueProp, false),
    requested' = if (moves(false)) false else requested,
    outcome' = if (moves(false)) verdict else outcome,
    base' = if (moves(false)) menuOpen else base,
    requests' = if (moves(false)) requests + 1 else requests
  }

  // request: pointer click on the button toggles the menu; opening focuses the
  // first item, closing returns focus to the button
  action click_button = all {
    focusLevel' = if (rejects(not(menuOpen))) focusLevel else if (menuOpen) 1 else 2,
    focusIdx' = if (rejects(not(menuOpen))) focusIdx else if (menuOpen) 0 else 1,
    menuOpen' = landed(holds, menuOpen, not(menuOpen)),
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = propAfter(follows, valueProp, not(menuOpen)),
    requested' = if (moves(not(menuOpen))) not(menuOpen) else requested,
    outcome' = if (moves(not(menuOpen))) verdict else outcome,
    base' = if (moves(not(menuOpen))) menuOpen else base,
    requests' = if (moves(not(menuOpen))) requests + 1 else requests
  }

  // request: Enter / Space on the button opens on the first item; on an enabled
  // item activates it, closes the menu and returns focus to the button
  action activate = {
    nondet key = Set("Enter", "Space").oneOf()
    all {
      focusLevel' = if (rejects(activateWant)) focusLevel
        else if (focusLevel == 1) 2
        else if (and(focusLevel == 2, not(isDisabled(focusIdx)))) 1
        else focusLevel,
      focusIdx' = if (rejects(activateWant)) focusIdx
        else if (focusLevel == 1) 1
        else if (and(focusLevel == 2, not(isDisabled(focusIdx)))) 0
        else focusIdx,
      menuOpen' = landed(holds, menuOpen, activateWant),
      lastActivated' = if (and(focusLevel == 2, not(isDisabled(focusIdx)))) focusIdx else lastActivated,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = propAfter(follows, valueProp, activateWant),
      requested' = if (moves(activateWant)) activateWant else requested,
      outcome' = if (moves(activateWant)) verdict else outcome,
      base' = if (moves(activateWant)) menuOpen else base,
      requests' = if (moves(activateWant)) requests + 1 else requests
    }
  }

  // request: (optional) Down Arrow: button opens on the first item; menu moves next
  action arrow_down = all {
    focusLevel' = if (rejects(downWant)) focusLevel else if (focusLevel == 1) 2 else focusLevel,
    focusIdx' = if (rejects(downWant)) focusIdx
      else if (focusLevel == 1) 1
      else if (focusLevel == 2) ariaWrapNext1(focusIdx, 4)
      else focusIdx,
    menuOpen' = landed(holds, menuOpen, downWant),
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = propAfter(follows, valueProp, downWant),
    requested' = if (moves(downWant)) downWant else requested,
    outcome' = if (moves(downWant)) verdict else outcome,
    base' = if (moves(downWant)) menuOpen else base,
    requests' = if (moves(downWant)) requests + 1 else requests
  }

  // request: (optional) Up Arrow: button opens on the last item; menu moves previous
  action arrow_up = all {
    focusLevel' = if (rejects(downWant)) focusLevel else if (focusLevel == 1) 2 else focusLevel,
    focusIdx' = if (rejects(downWant)) focusIdx
      else if (focusLevel == 1) 4
      else if (focusLevel == 2) ariaWrapPrev1(focusIdx, 4)
      else focusIdx,
    menuOpen' = landed(holds, menuOpen, downWant),
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = propAfter(follows, valueProp, downWant),
    requested' = if (moves(downWant)) downWant else requested,
    outcome' = if (moves(downWant)) verdict else outcome,
    base' = if (moves(downWant)) menuOpen else base,
    requests' = if (moves(downWant)) requests + 1 else requests
  }

  action key_home = all {
    focusLevel' = focusLevel,
    focusIdx' = if (focusLevel == 2) 1 else focusIdx,
    menuOpen' = menuOpen,
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
    focusLevel' = focusLevel,
    focusIdx' = if (focusLevel == 2) 4 else focusIdx,
    menuOpen' = menuOpen,
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  // request: Escape closes and returns focus to the button
  action escape = all {
    focusLevel' = if (rejects(escapeWant)) focusLevel else if (focusLevel == 2) 1 else focusLevel,
    focusIdx' = if (rejects(escapeWant)) focusIdx else if (focusLevel == 2) 0 else focusIdx,
    menuOpen' = landed(holds, menuOpen, escapeWant),
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = propAfter(follows, valueProp, escapeWant),
    requested' = if (moves(escapeWant)) escapeWant else requested,
    outcome' = if (moves(escapeWant)) verdict else outcome,
    base' = if (moves(escapeWant)) menuOpen else base,
    requests' = if (moves(escapeWant)) requests + 1 else requests
  }

  // printable character: next item (after the focused one, wrapping) with that label
  action typeahead = {
    nondet ch = Set(1, 2, 3).oneOf()
    all {
      focusLevel' = focusLevel,
      focusIdx' = if (focusLevel == 2) typeTarget(focusIdx, ch) else focusIdx,
      menuOpen' = menuOpen,
      lastActivated' = lastActivated,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = valueProp,
      requested' = requested,
      outcome' = outcome,
      base' = base,
      requests' = requests
    }
  }

  // commit: the host writes the controlled open state (a no-op while uncontrolled)
  action setValue = {
    nondet v = Set(true, false).oneOf()
    all {
      focusLevel' = if (controlled) (if (v) 2 else 1) else focusLevel,
      focusIdx' = if (controlled) (if (v) 1 else 0) else focusIdx,
      menuOpen' = if (controlled) v else menuOpen,
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

  // commit: the host flips its own copy of the open state
  action hostToggle = all {
    focusLevel' = if (controlled) (if (valueProp) 1 else 2) else focusLevel,
    focusIdx' = if (controlled) (if (valueProp) 0 else 1) else focusIdx,
    menuOpen' = if (controlled) not(valueProp) else menuOpen,
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = if (controlled) not(valueProp) else valueProp,
    requested' = requested,
    outcome' = if (controlled) "none" else outcome,
    base' = base,
    requests' = requests
  }

  // configuration: the host starts owning the open state, adopting the current one
  action control = all {
    focusLevel' = focusLevel,
    focusIdx' = focusIdx,
    menuOpen' = menuOpen,
    lastActivated' = lastActivated,
    controlled' = true,
    accepting' = accepting,
    valueProp' = menuOpen,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  // configuration: the controlled host answers every request with its intent
  action acceptRequests = all {
    focusLevel' = focusLevel,
    focusIdx' = focusIdx,
    menuOpen' = menuOpen,
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
    init, focus_in, tab_out, click_button, activate, arrow_down, arrow_up,
    key_home, key_end, escape, typeahead, setValue, hostToggle, control, acceptRequests
  }

  val LevelValid: bool = and(focusLevel >= 0, focusLevel <= 2)
  // aria-expanded is true exactly while focus is managed inside the menu
  val ExpandedIffFocusInMenu: bool = ariaExpanded(menuOpen) == (focusLevel == 2)
  // focus is on a real item while open, and on no item otherwise
  val FocusIdxInRange: bool =
    if (focusLevel == 2) and(focusIdx >= 1, focusIdx <= 4) else focusIdx == 0
  // a disabled item can never have been activated
  val DisabledNeverActivated: bool =
    and(lastActivated >= 0, lastActivated <= 4, not(and(lastActivated > 0, ariaDisabled(lastActivated))))
  // the active descendant is the focused item while open, none otherwise
  val ActiveDescendantMatchesFocus: bool =
    ariaActiveDescendant(focusLevel, focusIdx) == (if (menuOpen) focusIdx else 0)
  // callbacks only ever count up from zero
  val RequestsNonNegative: bool = requests >= 0
  // controlled: only the value prop sets the state, so no event commits
  val ControlledFollowsProp: bool = or(not(controlled), menuOpen == valueProp)
  // a rejected request leaves the state as it found it
  val RejectedRequestUntouched: bool = or(not(outcome == "rejected"), menuOpen == base)
  // an accepted request committed exactly its intent
  val AcceptedRequestCommits: bool = or(not(outcome == "accepted"), menuOpen == requested)
}
