// WAI-ARIA APG pattern: Tabs — one tablist, four tab/tabpanel pairs.
// https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
// Examples: .../examples/tabs-automatic/ and .../examples/tabs-manual/
//
// Modelled (APG "Keyboard Interaction" + "WAI-ARIA Roles, States, and Properties"):
//   - Tab: focus enters the tablist on the ACTIVE (selected) tab, the next Tab
//     leaves the tablist for the tabpanel, then out. Shift+Tab walks it back.
//   - Roving tabindex: tabindex=0 sits on the selected tab only, every other
//     tab is -1 (as in both APG examples: arrows move DOM focus by script
//     without touching tabindex; only selection moves the tab stop).
//   - Left/Right Arrow (horizontal) and Up/Down Arrow (vertical): previous/next
//     tab, wrapping last->first and first->last. Arrows of the other axis are
//     ignored.
//   - Home / End: first / last tab.
//   - Automatic activation: moving focus selects (tabs-automatic example).
//     Manual activation: moving focus only moves focus; Enter / Space selects
//     the focused tab (tabs-manual example).
//   - Delete (optional, `deletable` flavor): removes the focused tab and its
//     panel; focus goes to the following tab, or the previous one when the
//     deleted tab was last. A deleted selected tab hands selection to the tab
//     that receives focus.
//   - Disabled tabs: skipped by arrows/Home/End/Delete-focus, ignore clicks.
//   - Pointer: clicking an enabled tab focuses and selects it in BOTH modes.
//   - Panel shown = selected tab's panel (aria-selected / aria-controls /
//     aria-labelledby are derived defs; tab k controls panel k by index).
//
// Variants (activation x orientation x deletable x disabled-tab mask) are one
// nondet pool on `configure`, which remounts the widget (the generator allows
// one nondet per action, so the variant is a packed int). `configure` also
// drops the host back to uncontrolled.
//
// Request vs commit (map ticket rt1p). Selection is the value. Every event a
// user sees as a selection — `click` and `press` — is a *request* carrying an
// intent (`requested`); it fires onValueChange (`requests` counts the calls)
// when the intent differs from the current `selected`, and then:
//   uncontrolled        the request is accepted: selection commits the intent
//   controlled, holds   the host ignores it ("rejected"): selection is untouched
//   controlled, accepts the host answers with the same value (`accepting`): the
//                       selection commits through the controlled value, not the event
// `valueProp` is the only thing that changes selection while `controlled`;
// `setValue` is the host writing it. `control` / `acceptRequests` are
// configuration events (init is literal-only). DOM focus still moves with the
// request (roving focus), so `AutomaticSelectionFollowsFocus` is an
// uncontrolled guarantee. Invariants for the model: ControlledFollowsProp,
// RejectedRequestUntouched, AcceptedRequestCommits.
//
// Deliberate omissions:
//   - RTL (Left/Right swap) and tablist `aria-label` / `aria-labelledby`.
//   - Dynamic disable/enable of a tab, tab insertion, an empty tablist:
//     deleting the last focusable tab is refused (Delete is a no-op).
//   - Typeahead, Shift+F10 / context menus, focus inside the panel content.
//   - Non-wrapping navigation (APG examples always wrap).
//   - Focusing disabled tabs (APG is silent; we follow react-aria/Base UI and
//     skip them).
//   - Delete while controlled: a host-owned tablist never loses a tab through
//     a user event.
//
// Generator gaps hit: one nondet per action (packed variant int), no
// collections (tabs are bit-masks over a fixed 4 slots), no `const`.
module apg_tabs {
  import aria.* from "../../shared/aria"

  var activation: str  // "automatic" | "manual"
  var orientation: str // "horizontal" | "vertical" (aria-orientation)
  var deletable: bool  // Delete removes the focused tab
  var disabled: int    // bit k set = tab k is aria-disabled
  var present: int     // bit k set = tab k (and panel k) is in the DOM
  var selected: int    // aria-selected tab (also the tabindex=0 tab)
  var focused: int     // tab that has / last had DOM focus
  var zone: str        // "outside" | "tablist" | "panel": where DOM focus is
  var controlled: bool // the host owns the selection (`value` prop present)
  var accepting: bool  // controlled host that answers every request with its intent
  var valueProp: int   // the controlled value prop (meaningful while controlled)
  var requested: int   // intent of the last request
  var requests: int    // number of requests that fired onSelectionChange
  var outcome: str     // "none" | "accepted" | "rejected"
  var base: int        // selection when the last request was received

  // ---- bit-mask helpers over the 4 tab slots ------------------------------
  def pow2(k: int): int =
    if (k == 0) 1 else if (k == 1) 2 else if (k == 2) 4 else 8
  def hasBit(mask: int, k: int): bool =
    and(k >= 0, k <= 3, (mask / pow2(k)) % 2 == 1)
  def one(b: bool): int = if (b) 1 else 0

  // a tab can take focus / selection: in the DOM and not disabled
  def focusable(k: int, p: int, d: int): bool =
    and(hasBit(p, k), not(hasBit(d, k)))
  def focusableCount(p: int, d: int): int =
    one(focusable(0, p, d)) + one(focusable(1, p, d)) +
    one(focusable(2, p, d)) + one(focusable(3, p, d))

  // ---- navigation targets -------------------------------------------------
  def nextWrap(i: int, p: int, d: int): int =
    if (focusable((i + 1) % 4, p, d)) (i + 1) % 4
    else if (focusable((i + 2) % 4, p, d)) (i + 2) % 4
    else if (focusable((i + 3) % 4, p, d)) (i + 3) % 4
    else i
  def prevWrap(i: int, p: int, d: int): int =
    if (focusable((i + 3) % 4, p, d)) (i + 3) % 4
    else if (focusable((i + 2) % 4, p, d)) (i + 2) % 4
    else if (focusable((i + 1) % 4, p, d)) (i + 1) % 4
    else i
  def firstTab(p: int, d: int): int =
    if (focusable(0, p, d)) 0
    else if (focusable(1, p, d)) 1
    else if (focusable(2, p, d)) 2
    else 3
  def lastTab(p: int, d: int): int =
    if (focusable(3, p, d)) 3
    else if (focusable(2, p, d)) 2
    else if (focusable(1, p, d)) 1
    else 0
  // Delete: the following tab, else the previous one (no wrap)
  def afterDelete(i: int, p: int, d: int): int =
    if (focusable(i + 1, p, d)) i + 1
    else if (focusable(i + 2, p, d)) i + 2
    else if (focusable(i + 3, p, d)) i + 3
    else if (focusable(i - 1, p, d)) i - 1
    else if (focusable(i - 2, p, d)) i - 2
    else i - 3

  def isNavKey(key: str, o: str): bool =
    or(ariaAxisForward(o, key), ariaAxisBackward(o, key), key == "Home", key == "End")
  def navTarget(key: str, o: str, i: int, p: int, d: int): int =
    if (ariaAxisForward(o, key)) nextWrap(i, p, d)
    else if (ariaAxisBackward(o, key)) prevWrap(i, p, d)
    else if (key == "Home") firstTab(p, d)
    else if (key == "End") lastTab(p, d)
    else i

  // ---- key handling (only while DOM focus is on a tab) --------------------
  // a host-owned tablist never loses a tab through a user event
  def deleting(zn: str, key: str, del: bool, i: int, p: int, d: int): bool =
    and(not(controlled), and(zn == "tablist", key == "Delete", del, focusableCount(p, d) > 1))
  def pressFocused(zn: str, key: str, o: str, del: bool, i: int, p: int, d: int): int =
    if (zn != "tablist") i
    else if (deleting(zn, key, del, i, p, d)) afterDelete(i, p, d)
    else navTarget(key, o, i, p, d)
  def pressSelected(zn: str, key: str, act: str, o: str, del: bool, sel: int, i: int, p: int, d: int): int =
    if (zn != "tablist") sel
    else if (deleting(zn, key, del, i, p, d)) (if (sel == i) afterDelete(i, p, d) else sel)
    else if (and(act == "automatic", isNavKey(key, o))) navTarget(key, o, i, p, d)
    else if (or(key == "Enter", key == " ")) i
    else sel

  // ---- Tab / Shift+Tab: outside -> tablist -> panel -> outside ------------
  def enteringTablist(zn: str, shift: bool): bool =
    or(and(zn == "outside", not(shift)), and(zn == "panel", shift))
  def nextZone(zn: str, shift: bool): str =
    if (shift)
      (if (zn == "outside") "panel" else if (zn == "panel") "tablist" else "outside")
    else
      (if (zn == "outside") "tablist" else if (zn == "tablist") "panel" else "outside")

  // ---- request / commit (map ticket rt1p) ---------------------------------
  // a change of intent fires onSelectionChange; an inert event (same intent) does not
  def moved(before: int, after: int): int = if (before == after) 0 else 1
  // the tab a pointer click would select (an unenabled target is inert)
  def clickWant(tab: int, p: int, d: int, sel: int): int =
    if (focusable(tab, p, d)) tab else sel
  // controlled host that keeps the old value: the request is rejected
  def holds: bool = and(controlled, not(accepting))
  // controlled host that writes the intent back through the value prop
  def follows: bool = and(controlled, accepting)
  def verdict: str = if (holds) "rejected" else "accepted"
  // the selection after a request for `want`
  def landed(h: bool, current: int, want: int): int = if (h) current else want
  // the value prop after a request for `want`
  def propAfter(f: bool, p: int, want: int): int = if (f) want else p

  // ---- configure: packed variant (see header) -----------------------------
  def variantActivation(v: int): str = if (v % 2 == 0) "automatic" else "manual"
  def variantOrientation(v: int): str = if ((v / 2) % 2 == 0) "horizontal" else "vertical"
  def variantDeletable(v: int): bool = (v / 4) % 2 == 1
  def variantDisabled(v: int): int =
    if ((v / 8) % 5 == 0) 0
    else if ((v / 8) % 5 == 1) 1
    else if ((v / 8) % 5 == 2) 2
    else if ((v / 8) % 5 == 3) 5
    else 14

  // ---- ARIA contract, derived from state ----------------------------------
  // tab k: role=tab, aria-selected, tabindex, aria-disabled
  def ariaSelected(k: int, p: int, sel: int): bool = and(hasBit(p, k), k == sel)
  def tabIndex(k: int, p: int, sel: int): int = if (ariaSelected(k, p, sel)) 0 else -1
  def ariaDisabled(k: int, d: int): bool = hasBit(d, k)
  // panel k: role=tabpanel, aria-labelledby=tab k; visible iff its tab is selected
  def panelVisible(k: int, p: int, sel: int): bool = ariaSelected(k, p, sel)
  def selectedCount(p: int, sel: int): int =
    one(ariaSelected(0, p, sel)) + one(ariaSelected(1, p, sel)) +
    one(ariaSelected(2, p, sel)) + one(ariaSelected(3, p, sel))
  def tabStopCount(p: int, sel: int): int =
    one(tabIndex(0, p, sel) == 0) + one(tabIndex(1, p, sel) == 0) +
    one(tabIndex(2, p, sel) == 0) + one(tabIndex(3, p, sel) == 0)
  def tabStopIndex(p: int, sel: int): int =
    one(tabIndex(1, p, sel) == 0) + 2 * one(tabIndex(2, p, sel) == 0) +
    3 * one(tabIndex(3, p, sel) == 0)
  def visiblePanelCount(p: int, sel: int): int =
    one(panelVisible(0, p, sel)) + one(panelVisible(1, p, sel)) +
    one(panelVisible(2, p, sel)) + one(panelVisible(3, p, sel))
  def visiblePanelIndex(p: int, sel: int): int =
    one(panelVisible(1, p, sel)) + 2 * one(panelVisible(2, p, sel)) +
    3 * one(panelVisible(3, p, sel))

  action init = all {
    activation' = "automatic",
    orientation' = "horizontal",
    deletable' = false,
    disabled' = 0,
    present' = 15,
    selected' = 0,
    focused' = 0,
    zone' = "outside",
    controlled' = false,
    accepting' = false,
    valueProp' = 0,
    requested' = 0,
    requests' = 0,
    outcome' = "none",
    base' = 0
  }

  // remount with a variant: all four tabs present, first enabled tab selected;
  // the widget is uncontrolled again until the host asks to own it
  action configure = {
    nondet flavor = Set(
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
      20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39
    ).oneOf()
    all {
      activation' = variantActivation(flavor),
      orientation' = variantOrientation(flavor),
      deletable' = variantDeletable(flavor),
      disabled' = variantDisabled(flavor),
      present' = 15,
      selected' = firstTab(15, variantDisabled(flavor)),
      focused' = firstTab(15, variantDisabled(flavor)),
      zone' = "outside",
      controlled' = false,
      accepting' = false,
      valueProp' = firstTab(15, variantDisabled(flavor)),
      requested' = firstTab(15, variantDisabled(flavor)),
      requests' = 0,
      outcome' = "none",
      base' = firstTab(15, variantDisabled(flavor))
    }
  }

  // Tab (shift = false) / Shift+Tab (shift = true)
  action tab_key = {
    nondet shift = Set(true, false).oneOf()
    all {
      activation' = activation,
      orientation' = orientation,
      deletable' = deletable,
      disabled' = disabled,
      present' = present,
      selected' = selected,
      focused' = if (enteringTablist(zone, shift)) selected else focused,
      zone' = nextZone(zone, shift),
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = valueProp,
      requested' = requested,
      requests' = requests,
      outcome' = outcome,
      base' = base
    }
  }

  // request: a keydown on the focused tab (a no-op unless DOM focus is in the
  // tablist); automatic navigation and manual Enter/Space change selection
  action press = {
    nondet key = Set("ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Enter", " ", "Delete").oneOf()
    all {
      activation' = activation,
      orientation' = orientation,
      deletable' = deletable,
      disabled' = disabled,
      present' = if (deleting(zone, key, deletable, focused, present, disabled)) present - pow2(focused) else present,
      selected' = landed(holds, selected, pressSelected(zone, key, activation, orientation, deletable, selected, focused, present, disabled)),
      focused' = pressFocused(zone, key, orientation, deletable, focused, present, disabled),
      zone' = zone,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = propAfter(follows, valueProp, pressSelected(zone, key, activation, orientation, deletable, selected, focused, present, disabled)),
      requested' = if (moved(selected, pressSelected(zone, key, activation, orientation, deletable, selected, focused, present, disabled)) == 1) pressSelected(zone, key, activation, orientation, deletable, selected, focused, present, disabled) else requested,
      requests' = requests + moved(selected, pressSelected(zone, key, activation, orientation, deletable, selected, focused, present, disabled)),
      outcome' = if (moved(selected, pressSelected(zone, key, activation, orientation, deletable, selected, focused, present, disabled)) == 1) verdict else outcome,
      base' = if (moved(selected, pressSelected(zone, key, activation, orientation, deletable, selected, focused, present, disabled)) == 1) selected else base
    }
  }

  // request: a pointer click on tab `tab` focuses and selects an enabled tab in
  // both modes (an unenabled target is inert)
  action click = {
    nondet tab = Set(0, 1, 2, 3).oneOf()
    all {
      activation' = activation,
      orientation' = orientation,
      deletable' = deletable,
      disabled' = disabled,
      present' = present,
      selected' = landed(holds, selected, clickWant(tab, present, disabled, selected)),
      focused' = if (focusable(tab, present, disabled)) tab else focused,
      zone' = if (focusable(tab, present, disabled)) "tablist" else zone,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = propAfter(follows, valueProp, clickWant(tab, present, disabled, selected)),
      requested' = if (moved(selected, clickWant(tab, present, disabled, selected)) == 1) clickWant(tab, present, disabled, selected) else requested,
      requests' = requests + moved(selected, clickWant(tab, present, disabled, selected)),
      outcome' = if (moved(selected, clickWant(tab, present, disabled, selected)) == 1) verdict else outcome,
      base' = if (moved(selected, clickWant(tab, present, disabled, selected)) == 1) selected else base
    }
  }

  // commit: the host writes the controlled selection (a no-op while uncontrolled)
  action setValue = {
    nondet v = Set(0, 1, 2, 3).oneOf()
    all {
      activation' = activation,
      orientation' = orientation,
      deletable' = deletable,
      disabled' = disabled,
      present' = present,
      selected' = if (and(controlled, focusable(v, present, disabled))) v else selected,
      focused' = focused,
      zone' = zone,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = if (and(controlled, focusable(v, present, disabled))) v else valueProp,
      requested' = requested,
      requests' = requests,
      outcome' = if (controlled) "none" else outcome,
      base' = base
    }
  }

  // configuration: the host starts owning the selection, adopting the current one
  action control = all {
    activation' = activation,
    orientation' = orientation,
    deletable' = deletable,
    disabled' = disabled,
    present' = present,
    selected' = selected,
    focused' = focused,
    zone' = zone,
    controlled' = true,
    accepting' = accepting,
    valueProp' = selected,
    requested' = requested,
    requests' = requests,
    outcome' = outcome,
    base' = base
  }

  // configuration: the controlled host answers every request with its intent
  action acceptRequests = all {
    activation' = activation,
    orientation' = orientation,
    deletable' = deletable,
    disabled' = disabled,
    present' = present,
    selected' = selected,
    focused' = focused,
    zone' = zone,
    controlled' = controlled,
    accepting' = true,
    valueProp' = valueProp,
    requested' = requested,
    requests' = requests,
    outcome' = outcome,
    base' = base
  }

  action step = any { init, configure, tab_key, press, click, setValue, control, acceptRequests }

  val ConfigValid: bool = and(
    or(activation == "automatic", activation == "manual"),
    ariaOrientationKnown(orientation)
  )
  val ZoneValid: bool = or(zone == "outside", zone == "tablist", zone == "panel")
  val PresentInRange: bool = and(present >= 1, present <= 15)
  val AtLeastOneFocusableTab: bool = focusableCount(present, disabled) >= 1
  // selection and the DOM-focus cursor always rest on a live, enabled tab
  val SelectedTabIsFocusable: bool = focusable(selected, present, disabled)
  val FocusedTabIsFocusable: bool = focusable(focused, present, disabled)
  // exactly one tab is aria-selected
  val ExactlyOneSelectedTab: bool = selectedCount(present, selected) == 1
  // roving tabindex: exactly one tab stop (tabindex=0) and it is the selected tab
  val ExactlyOneTabStopOnSelected: bool =
    and(tabStopCount(present, selected) == 1, tabStopIndex(present, selected) == selected)
  // exactly one panel visible and it belongs to the selected tab
  val VisiblePanelIsSelectedTabPanel: bool =
    and(visiblePanelCount(present, selected) == 1, visiblePanelIndex(present, selected) == selected)
  // automatic activation: selection follows focus while focus is on a tab; a
  // controlled host that rejects a request leaves focus on the requested tab
  val AutomaticSelectionFollowsFocus: bool =
    or(activation != "automatic", zone != "tablist", controlled, selected == focused)
  // only deletable tablists ever lose a tab
  val OnlyDeletableLosesTabs: bool = or(deletable, present == 15)
  // callbacks only ever count up from zero
  val RequestsNonNegative: bool = requests >= 0
  // controlled: only the value prop sets the state, so no event commits
  val ControlledFollowsProp: bool = or(not(controlled), selected == valueProp)
  // a rejected request leaves the state as it found it
  val RejectedRequestUntouched: bool = or(not(outcome == "rejected"), selected == base)
  // an accepted request committed exactly its intent
  val AcceptedRequestCommits: bool = or(not(outcome == "accepted"), selected == requested)
}
