// WAI-ARIA APG — Radio Group pattern (radiogroup + 4 radio items).
//
// Modelled (https://www.w3.org/WAI/ARIA/apg/patterns/radio/):
//   - "Keyboard Interaction / Radio Groups Not Contained in a Toolbar":
//       Tab / Shift+Tab   focus enters the group on the checked radio, or on the
//                         first radio when none is checked (entering never checks)
//       Space             checks the focused radio if not already checked
//       Right / Down      focus AND check the next radio, last wraps to first
//       Left / Up         focus AND check the previous radio, first wraps to last
//   - "WAI-ARIA Roles, States, and Properties": role radiogroup / radio,
//     aria-checked true|false on every radio.
// Examples (variants of the SAME machine, chosen once at init via `flavor`):
//   - roving   https://www.w3.org/WAI/ARIA/apg/patterns/radio/examples/radio/
//              DOM focus sits on the radio; tabindex 0 on the tab stop radio,
//              -1 on the others; the radiogroup has no tabindex.
//   - activedescendant
//              https://www.w3.org/WAI/ARIA/apg/patterns/radio/examples/radio-activedescendant/
//              DOM focus sits on the radiogroup (tabindex 0); radios carry no
//              tabindex; aria-activedescendant on the group names the
//              visually-focused radio while focus is inside the group.
// Disabled radios (task requirement, not in the APG examples): they are never
// focused, checked or the tab stop; arrows skip them (wrapping across them).
//
// Request vs commit (map ticket rt1p). The checked radio is the value. Every
// event a user sees as a change — `arrow_next`, `arrow_prev`, `space`, `click`
// — is a *request* carrying an intent (`requested`); it fires onValueChange
// (`requests` counts the calls) when the intent differs from the current
// `checked`, and then:
//   uncontrolled        the request is accepted: the check commits the intent
//   controlled, holds   the host ignores it ("rejected"): the check is untouched
//   controlled, accepts the host answers with the same value (`accepting`): the
//                       check commits through the controlled value, not the event
// `valueProp` is the only thing that changes the check while `controlled`;
// `setValue` is the host writing it. `control` / `acceptRequests` are
// configuration events (init is literal-only). DOM focus still moves with the
// request, so `FocusFollowsChecked` is an uncontrolled guarantee. Invariants
// for the model: ControlledFollowsProp, RejectedRequestUntouched,
// AcceptedRequestCommits.
//
// Pools / constants: 4 radios (indexes 0..3); `mask` is a bitmask of disabled
// radios (bit i = radio i), drawn from a pool that always leaves one enabled;
// `pick` is the preselected radio (-1 = none). `init` is the literal default
// (roving, none disabled, none checked); set_flavor / set_disabled / preselect
// re-mount the widget with other props (focus leaves the group) and follow the
// controlled value.
//
// Sentinels: focus/checked -1 = none. domFocus: 0..3 = a radio, 4 = the
// radiogroup element, -1 = outside the group. tabindex: -2 = attribute absent.
//
// Deliberate omissions: the toolbar flavor, the radio-rating example, Enter,
// aria-labelledby / aria-describedby / aria-label wiring, mouse hover, disabling
// without a re-mount, Shift+Tab "last radio" native-browser difference,
// dynamic add/remove of radios. Click is modelled as focus+check of an enabled radio.
//
// ponytail: radio count is fixed at 4; the generator has no sets/lists, so the
// group is unrolled into index arithmetic. Widen the modulus and weight table
// to grow it.
module apg_radio {
  var flavor: str  // "roving" | "activedescendant"
  var mask: int     // disabled bitmask (bit i set = radio i disabled)
  var checked: int  // checked radio, -1 = none
  var focus: int    // radio holding (visual) focus, -1 = focus outside the group
  var controlled: bool // the host owns the check (`value` prop present)
  var accepting: bool  // controlled host that answers every request with its intent
  var valueProp: int   // the controlled value prop (meaningful while controlled)
  var requested: int   // intent of the last request
  var requests: int    // number of requests that fired onValueChange
  var outcome: str     // "none" | "accepted" | "rejected"
  var base: int        // check when the last request was received

  def weight(i: int): int =
    if (i == 0) 1 else if (i == 1) 2 else if (i == 2) 4 else 8
  def disabled(m: int, i: int): bool = imod(idiv(m, weight(i)), 2) == 1
  def isEnabled(m: int, i: int): bool = not(disabled(m, i))
  def b2i(b: bool): int = if (b) 1 else 0

  // first enabled radio (the pool guarantees at least one)
  def firstEnabled(m: int): int =
    if (isEnabled(m, 0)) 0 else if (isEnabled(m, 1)) 1 else if (isEnabled(m, 2)) 2 else 3

  // arrow targets: skip disabled radios, wrap around; stay put if alone
  def nextEnabled(m: int, i: int): int =
    if (isEnabled(m, imod(i + 1, 4))) imod(i + 1, 4)
    else if (isEnabled(m, imod(i + 2, 4))) imod(i + 2, 4)
    else if (isEnabled(m, imod(i + 3, 4))) imod(i + 3, 4)
    else i
  def prevEnabled(m: int, i: int): int =
    if (isEnabled(m, imod(i + 3, 4))) imod(i + 3, 4)
    else if (isEnabled(m, imod(i + 2, 4))) imod(i + 2, 4)
    else if (isEnabled(m, imod(i + 1, 4))) imod(i + 1, 4)
    else i

  // ---- request / commit (map ticket rt1p) ----------------------------------
  def moved(before: int, after: int): int = if (before == after) 0 else 1
  // the intent of each request (an enabled target, or the current check)
  def nextWant(m: int, c: int, f: int): int = if (f >= 0) nextEnabled(m, f) else c
  def prevWant(m: int, c: int, f: int): int = if (f >= 0) prevEnabled(m, f) else c
  def spaceWant(c: int, f: int): int = if (f >= 0) f else c
  def clickWant(t: int, m: int, c: int): int = if (isEnabled(m, t)) t else c
  // a value the host may write: -1 (none) or an enabled radio
  def validPick(v: int, m: int): bool = or(v < 0, isEnabled(m, v))
  // controlled host that keeps the old value: the request is rejected
  def holds: bool = and(controlled, not(accepting))
  // controlled host that writes the intent back through the value prop
  def follows: bool = and(controlled, accepting)
  def verdict: str = if (holds) "rejected" else "accepted"
  // the check after a request for `want`
  def landed(h: bool, current: int, want: int): int = if (h) current else want
  // the value prop after a request for `want`
  def propAfter(f: bool, p: int, want: int): int = if (f) want else p

  // ---- ARIA contract, derived from state ----

  // the radio Tab lands on: the checked one, else the first enabled one
  def tabStop(m: int, c: int): int = if (c >= 0) c else firstEnabled(m)

  def ariaChecked(c: int, i: int): bool = c == i
  def ariaDisabled(m: int, i: int): bool = disabled(m, i)

  // roving: tabindex 0 on the tab stop, -1 elsewhere; activedescendant: absent
  def radioTabindex(v: str, m: int, c: int, i: int): int =
    if (v == "roving") (if (i == tabStop(m, c)) 0 else -1) else -2
  // activedescendant: the radiogroup itself is the tab stop; roving: absent
  def groupTabindex(v: str): int = if (v == "activedescendant") 0 else -2
  // aria-activedescendant on the radiogroup: the focused radio, -1 = absent
  def activeDescendant(v: str, f: int): int =
    if (v == "activedescendant") f else -1
  // which element owns DOM focus
  def domFocus(v: str, f: int): int =
    if (f < 0) -1 else if (v == "roving") f else 4

  def checkedCount(c: int): int =
    b2i(ariaChecked(c, 0)) + b2i(ariaChecked(c, 1)) + b2i(ariaChecked(c, 2)) + b2i(ariaChecked(c, 3))
  // tab stops contributed by one radio / the group, summed over the widget
  def tabStopCount(v: str, m: int, c: int): int =
    b2i(radioTabindex(v, m, c, 0) == 0) + b2i(radioTabindex(v, m, c, 1) == 0)
      + b2i(radioTabindex(v, m, c, 2) == 0) + b2i(radioTabindex(v, m, c, 3) == 0)
      + b2i(groupTabindex(v) == 0)

  action init = all {
    flavor' = "roving",
    mask' = 0,
    checked' = -1,
    focus' = -1,
    controlled' = false,
    accepting' = false,
    valueProp' = -1,
    requested' = -1,
    requests' = 0,
    outcome' = "none",
    base' = -1
  }

  // The three configuration actions model (re)mounting the widget with other
  // props: they drop focus out of the group, so every later state is reached
  // through the keyboard/pointer actions below. While controlled they keep the
  // value prop in step with the check.
  action set_flavor = {
    nondet v = Set("roving", "activedescendant").oneOf()
    all {
      flavor' = v,
      mask' = mask,
      checked' = checked,
      focus' = -1,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = valueProp,
      requested' = requested,
      requests' = requests,
      outcome' = outcome,
      base' = base
    }
  }

  // disabled radios; the pool always leaves one enabled, and a checked radio
  // that becomes disabled is unchecked
  action set_disabled = {
    nondet m = Set(0, 1, 2, 6, 9, 14).oneOf()
    all {
      flavor' = flavor,
      mask' = m,
      checked' = if (and(checked >= 0, isEnabled(m, checked))) checked else -1,
      focus' = -1,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = if (controlled) (if (and(checked >= 0, isEnabled(m, checked))) checked else -1) else valueProp,
      requested' = requested,
      requests' = requests,
      outcome' = "none",
      base' = base
    }
  }

  // initially checked radio (-1 = none); a disabled pick leaves none checked
  action preselect = {
    nondet pick = Set(-1, 0, 1, 2, 3).oneOf()
    all {
      flavor' = flavor,
      mask' = mask,
      checked' = if (and(pick >= 0, isEnabled(mask, pick))) pick else -1,
      focus' = -1,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = if (controlled) (if (and(pick >= 0, isEnabled(mask, pick))) pick else -1) else valueProp,
      requested' = requested,
      requests' = requests,
      outcome' = "none",
      base' = base
    }
  }

  // Tab / Shift+Tab into the group: focus the tab stop, never check it.
  // Already inside: Tab leaves the group, which is `leave`.
  action enter = all {
    flavor' = flavor,
    mask' = mask,
    checked' = checked,
    focus' = if (focus < 0) tabStop(mask, checked) else focus,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    requests' = requests,
    outcome' = outcome,
    base' = base
  }

  action leave = all {
    flavor' = flavor,
    mask' = mask,
    checked' = checked,
    focus' = -1,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    requests' = requests,
    outcome' = outcome,
    base' = base
  }

  // request: Right / Down arrow moves focus and checks, wrapping, skipping disabled
  action arrow_next = all {
    flavor' = flavor,
    mask' = mask,
    checked' = landed(holds, checked, nextWant(mask, checked, focus)),
    focus' = if (focus >= 0) nextEnabled(mask, focus) else focus,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = propAfter(follows, valueProp, nextWant(mask, checked, focus)),
    requested' = if (moved(checked, nextWant(mask, checked, focus)) == 1) nextWant(mask, checked, focus) else requested,
    requests' = requests + moved(checked, nextWant(mask, checked, focus)),
    outcome' = if (moved(checked, nextWant(mask, checked, focus)) == 1) verdict else outcome,
    base' = if (moved(checked, nextWant(mask, checked, focus)) == 1) checked else base
  }

  // request: Left / Up arrow
  action arrow_prev = all {
    flavor' = flavor,
    mask' = mask,
    checked' = landed(holds, checked, prevWant(mask, checked, focus)),
    focus' = if (focus >= 0) prevEnabled(mask, focus) else focus,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = propAfter(follows, valueProp, prevWant(mask, checked, focus)),
    requested' = if (moved(checked, prevWant(mask, checked, focus)) == 1) prevWant(mask, checked, focus) else requested,
    requests' = requests + moved(checked, prevWant(mask, checked, focus)),
    outcome' = if (moved(checked, prevWant(mask, checked, focus)) == 1) verdict else outcome,
    base' = if (moved(checked, prevWant(mask, checked, focus)) == 1) checked else base
  }

  // request: Space checks the focused radio (no-op when already checked)
  action space = all {
    flavor' = flavor,
    mask' = mask,
    checked' = landed(holds, checked, spaceWant(checked, focus)),
    focus' = focus,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = propAfter(follows, valueProp, spaceWant(checked, focus)),
    requested' = if (moved(checked, spaceWant(checked, focus)) == 1) spaceWant(checked, focus) else requested,
    requests' = requests + moved(checked, spaceWant(checked, focus)),
    outcome' = if (moved(checked, spaceWant(checked, focus)) == 1) verdict else outcome,
    base' = if (moved(checked, spaceWant(checked, focus)) == 1) checked else base
  }

  // request: pointer on an enabled radio takes focus and becomes checked
  action click = {
    nondet target = Set(0, 1, 2, 3).oneOf()
    all {
      flavor' = flavor,
      mask' = mask,
      checked' = landed(holds, checked, clickWant(target, mask, checked)),
      focus' = if (isEnabled(mask, target)) target else focus,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = propAfter(follows, valueProp, clickWant(target, mask, checked)),
      requested' = if (moved(checked, clickWant(target, mask, checked)) == 1) clickWant(target, mask, checked) else requested,
      requests' = requests + moved(checked, clickWant(target, mask, checked)),
      outcome' = if (moved(checked, clickWant(target, mask, checked)) == 1) verdict else outcome,
      base' = if (moved(checked, clickWant(target, mask, checked)) == 1) checked else base
    }
  }

  // commit: the host writes the controlled check (a no-op while uncontrolled)
  action setValue = {
    nondet v = Set(-1, 0, 1, 2, 3).oneOf()
    all {
      flavor' = flavor,
      mask' = mask,
      checked' = if (and(controlled, validPick(v, mask))) v else checked,
      focus' = focus,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = if (and(controlled, validPick(v, mask))) v else valueProp,
      requested' = requested,
      requests' = requests,
      outcome' = if (controlled) "none" else outcome,
      base' = base
    }
  }

  // configuration: the host starts owning the check, adopting the current one
  action control = all {
    flavor' = flavor,
    mask' = mask,
    checked' = checked,
    focus' = focus,
    controlled' = true,
    accepting' = accepting,
    valueProp' = checked,
    requested' = requested,
    requests' = requests,
    outcome' = outcome,
    base' = base
  }

  // configuration: the controlled host answers every request with its intent
  action acceptRequests = all {
    flavor' = flavor,
    mask' = mask,
    checked' = checked,
    focus' = focus,
    controlled' = controlled,
    accepting' = true,
    valueProp' = valueProp,
    requested' = requested,
    requests' = requests,
    outcome' = outcome,
    base' = base
  }

  action step = any { init, set_flavor, set_disabled, preselect, enter, leave, arrow_next, arrow_prev, space, click, setValue, control, acceptRequests }

  // never more than one radio is aria-checked="true"
  val AtMostOneChecked: bool = checkedCount(checked) <= 1
  // exactly one tab stop for the whole group, in both variants
  val ExactlyOneTabStop: bool = tabStopCount(flavor, mask, checked) == 1
  // the tab stop is the checked radio, else the first (enabled) one
  val TabStopIsCheckedOrFirst: bool =
    if (checked >= 0) tabStop(mask, checked) == checked else tabStop(mask, checked) == firstEnabled(mask)
  // a disabled radio is never checked, focused or the tab stop
  val DisabledNeverActive: bool = and(
    or(checked < 0, isEnabled(mask, checked)),
    or(focus < 0, isEnabled(mask, focus)),
    isEnabled(mask, tabStop(mask, checked))
  )
  // focus and checked move together: once a radio is checked, focus inside
  // the group is always on it; before that it can only be on the first radio.
  // A controlled host that rejects a request leaves focus on the requested
  // radio, so this is an uncontrolled guarantee.
  val FocusFollowsChecked: bool = or(
    controlled,
    focus < 0,
    if (checked >= 0) focus == checked else focus == firstEnabled(mask)
  )
  // at least one radio can always be reached
  val SomeRadioEnabled: bool = or(isEnabled(mask, 0), isEnabled(mask, 1), isEnabled(mask, 2), isEnabled(mask, 3))
  // aria-activedescendant exists only while focus is inside an activedescendant group
  val ActiveDescendantContract: bool =
    if (flavor == "activedescendant")
      and(activeDescendant(flavor, focus) == focus, or(focus < 0, domFocus(flavor, focus) == 4))
    else
      and(activeDescendant(flavor, focus) == -1, domFocus(flavor, focus) == focus)
  val VariantValid: bool = or(flavor == "roving", flavor == "activedescendant")
  // callbacks only ever count up from zero
  val RequestsNonNegative: bool = requests >= 0
  // controlled: only the value prop sets the check, so no event commits
  val ControlledFollowsProp: bool = or(not(controlled), checked == valueProp)
  // a rejected request leaves the check as it found it
  val RejectedRequestUntouched: bool = or(not(outcome == "rejected"), checked == base)
  // an accepted request committed exactly its intent
  val AcceptedRequestCommits: bool = or(not(outcome == "accepted"), checked == requested)
}
