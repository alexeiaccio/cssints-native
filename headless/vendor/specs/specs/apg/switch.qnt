// WAI-ARIA APG — Switch pattern.
//
// Modelled from https://www.w3.org/WAI/ARIA/apg/patterns/switch/ :
//   - "About This Pattern": a binary on/off input (no third state, unlike a
//     checkbox or toggle button); the label never changes with the state
//   - "Keyboard Interaction": Space changes the state; Enter (optional) does too
//   - "WAI-ARIA Roles, States, and Properties": role=switch; aria-checked is
//     "true" when on and "false" when off
// and the Switch Examples (https://www.w3.org/WAI/ARIA/apg/patterns/switch/examples/switch/):
// Space is armed on keydown and flips on keyup (the native checkbox/button
// behaviour), Enter flips on keydown when the optional Enter support is on.
//
// Attribute contract (derived from state, never stored):
//   role         = "switch"
//   aria-checked = "true" (on) | "false" (off) — never "mixed", never absent
// Configuration variant: `enterToggles` (the APG's optional Enter key).
//
// Request vs commit (map ticket rt1p). Everything a user sees as a change —
// Enter, Space, a pointer click — is a *request* carrying an intent
// (`requested`). It fires onCheckedChange (`requests` counts the calls) when the
// intent differs from the current value, and then:
//   uncontrolled        the request is accepted: the state commits the intent
//   controlled, holds   the host ignores it ("rejected"): the state is untouched
//   controlled, accepts the host answers with the same value (`accepting`): the
//                       state commits through the controlled value, not the event
// The controlled value (`valueProp`) is the only thing that changes state while
// `controlled`; `setValue` / `hostToggle` are the host writing it. `control` and
// `acceptRequests` are configuration events (init is literal-only), like
// `set_disabled` / `set_enter_toggles`; `seed` is the configuration event that
// plants an initial value without counting as a request.
//
// Invariants for the model: ControlledFollowsProp (in controlled mode no event
// commits), RejectedRequestUntouched, AcceptedRequestCommits.
//
// `outcome` is "none" | "accepted" | "rejected" for the last request; a host
// write settles it back to "none". `base` is the value when it was received.
//
// Deliberate omissions:
//   - accessible name, aria-labelledby/aria-describedby, group/fieldset wiring
//   - the HTML input[type=checkbox] flavour (uses `checked` instead of aria-checked)
//   - the visible on/off text indicator (presentation)
//   - Enter key repeat and pointer-capture details
module apg_switch {
  var focused: bool       // the switch has keyboard focus
  var disabled: bool      // aria-disabled: focusable, never changes by user input
  var checked: str        // "true" (on) | "false" (off)
  var enterToggles: bool  // config: the optional Enter key also flips the switch
  var spaceArmed: bool    // Space went down on the focused switch, awaiting keyup
  var pointerArmed: bool  // pointer went down on the switch, awaiting release
  var requests: int       // onChange callbacks fired by user input (not by prop changes)
  var controlled: bool    // the host owns the value (`value` prop present)
  var accepting: bool     // controlled host that answers every request with its intent
  var valueProp: str      // the controlled value prop (meaningful while controlled)
  var requested: str      // intent of the last request
  var outcome: str        // "none" | "accepted" | "rejected"
  var base: str           // value when the last request was received

  def flip(checked: str): str = if (checked == "true") "false" else "true"

  def enterFires(focused: bool, disabled: bool, enterToggles: bool, key: str): bool =
    and(focused, not(disabled), enterToggles, key == "Enter")
  def spaceArms(focused: bool, disabled: bool, key: str): bool =
    and(focused, not(disabled), key == "Space")
  def spaceReleaseFires(armed: bool, disabled: bool, key: str): bool =
    and(armed, not(disabled), key == "Space")
  def pointerReleaseFires(armed: bool, disabled: bool): bool =
    and(armed, not(disabled))

  // ARIA attribute contract: a switch is only ever "true" or "false"
  def ariaChecked(checked: str): str = if (checked == "true") "true" else "false"

  // request / commit (map ticket rt1p)
  def holds: bool = and(controlled, not(accepting))
  def follows: bool = and(controlled, accepting)
  def verdict: str = if (holds) "rejected" else "accepted"
  // the value after a request for `want`
  def landed(h: bool, c: str, want: str): str = if (h) c else want
  // the value prop after a request for `want`
  def propAfter(f: bool, p: str, want: str): str = if (f) want else p

  action init = all {
    focused' = false,
    disabled' = false,
    checked' = "false",
    enterToggles' = false,
    spaceArmed' = false,
    pointerArmed' = false,
    requests' = 0,
    controlled' = false,
    accepting' = false,
    valueProp' = "false",
    requested' = "false",
    outcome' = "none",
    base' = "false"
  }

  action focus = all {
    focused' = true,
    disabled' = disabled,
    checked' = checked,
    enterToggles' = enterToggles,
    spaceArmed' = spaceArmed,
    pointerArmed' = pointerArmed,
    requests' = requests,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base
  }

  // blur cancels a pending Space press
  action blur = all {
    focused' = false,
    disabled' = disabled,
    checked' = checked,
    enterToggles' = enterToggles,
    spaceArmed' = false,
    pointerArmed' = pointerArmed,
    requests' = requests,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base
  }

  // request: Enter flips (optional), Space arms for keyup
  action key_down = {
    nondet key = Set("Space", "Enter", "Other").oneOf()
    all {
      focused' = focused,
      disabled' = disabled,
      checked' = if (enterFires(focused, disabled, enterToggles, key)) landed(holds, checked, flip(checked)) else checked,
      enterToggles' = enterToggles,
      spaceArmed' = if (spaceArms(focused, disabled, key)) true else spaceArmed,
      pointerArmed' = pointerArmed,
      requests' = if (enterFires(focused, disabled, enterToggles, key)) requests + 1 else requests,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = if (enterFires(focused, disabled, enterToggles, key)) propAfter(follows, valueProp, flip(checked)) else valueProp,
      requested' = if (enterFires(focused, disabled, enterToggles, key)) flip(checked) else requested,
      outcome' = if (enterFires(focused, disabled, enterToggles, key)) verdict else outcome,
      base' = if (enterFires(focused, disabled, enterToggles, key)) checked else base
    }
  }

  // request: Space released on the focused, enabled switch
  action key_up = {
    nondet key = Set("Space", "Enter", "Other").oneOf()
    all {
      focused' = focused,
      disabled' = disabled,
      checked' = if (spaceReleaseFires(spaceArmed, disabled, key)) landed(holds, checked, flip(checked)) else checked,
      enterToggles' = enterToggles,
      spaceArmed' = if (key == "Space") false else spaceArmed,
      pointerArmed' = pointerArmed,
      requests' = if (spaceReleaseFires(spaceArmed, disabled, key)) requests + 1 else requests,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = if (spaceReleaseFires(spaceArmed, disabled, key)) propAfter(follows, valueProp, flip(checked)) else valueProp,
      requested' = if (spaceReleaseFires(spaceArmed, disabled, key)) flip(checked) else requested,
      outcome' = if (spaceReleaseFires(spaceArmed, disabled, key)) verdict else outcome,
      base' = if (spaceReleaseFires(spaceArmed, disabled, key)) checked else base
    }
  }

  action pointer_down = all {
    focused' = true,
    disabled' = disabled,
    checked' = checked,
    enterToggles' = enterToggles,
    spaceArmed' = spaceArmed,
    pointerArmed' = not(disabled),
    requests' = requests,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base
  }

  // request: pointer released over the switch
  action pointer_up = all {
    focused' = focused,
    disabled' = disabled,
    checked' = if (pointerReleaseFires(pointerArmed, disabled)) landed(holds, checked, flip(checked)) else checked,
    enterToggles' = enterToggles,
    spaceArmed' = spaceArmed,
    pointerArmed' = false,
    requests' = if (pointerReleaseFires(pointerArmed, disabled)) requests + 1 else requests,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = if (pointerReleaseFires(pointerArmed, disabled)) propAfter(follows, valueProp, flip(checked)) else valueProp,
    requested' = if (pointerReleaseFires(pointerArmed, disabled)) flip(checked) else requested,
    outcome' = if (pointerReleaseFires(pointerArmed, disabled)) verdict else outcome,
    base' = if (pointerReleaseFires(pointerArmed, disabled)) checked else base
  }

  action pointer_cancel = all {
    focused' = focused,
    disabled' = disabled,
    checked' = checked,
    enterToggles' = enterToggles,
    spaceArmed' = spaceArmed,
    pointerArmed' = false,
    requests' = requests,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base
  }

  // commit: the host writes the controlled value (a no-op while uncontrolled).
  // A switch has no third state, so "mixed" is rejected.
  action setValue = {
    nondet incoming = Set("true", "false", "mixed").oneOf()
    all {
      focused' = focused,
      disabled' = disabled,
      checked' = if (and(controlled, not(incoming == "mixed"))) incoming else checked,
      enterToggles' = enterToggles,
      spaceArmed' = spaceArmed,
      pointerArmed' = pointerArmed,
      requests' = requests,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = if (and(controlled, not(incoming == "mixed"))) incoming else valueProp,
      requested' = requested,
      outcome' = if (controlled) "none" else outcome,
      base' = base
    }
  }

  // commit: the host flips its own copy of the value (an outside switch)
  action hostToggle = all {
    focused' = focused,
    disabled' = disabled,
    checked' = if (controlled) flip(valueProp) else checked,
    enterToggles' = enterToggles,
    spaceArmed' = spaceArmed,
    pointerArmed' = pointerArmed,
    requests' = requests,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = if (controlled) flip(valueProp) else valueProp,
    requested' = requested,
    outcome' = if (controlled) "none" else outcome,
    base' = base
  }

  // configuration: the host starts owning the value, adopting the current one
  action control = all {
    focused' = focused,
    disabled' = disabled,
    checked' = checked,
    enterToggles' = enterToggles,
    spaceArmed' = spaceArmed,
    pointerArmed' = pointerArmed,
    requests' = requests,
    controlled' = true,
    accepting' = accepting,
    valueProp' = checked,
    requested' = requested,
    outcome' = outcome,
    base' = base
  }

  // configuration: the controlled host answers every request with its intent
  action acceptRequests = all {
    focused' = focused,
    disabled' = disabled,
    checked' = checked,
    enterToggles' = enterToggles,
    spaceArmed' = spaceArmed,
    pointerArmed' = pointerArmed,
    requests' = requests,
    controlled' = controlled,
    accepting' = true,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base
  }

  // configuration: plant an initial value without counting as a request.
  // Inert while controlled: only the value prop may move the state there.
  action seed = {
    nondet incoming = Set("true", "false").oneOf()
    all {
      focused' = focused,
      disabled' = disabled,
      checked' = if (controlled) checked else incoming,
      enterToggles' = enterToggles,
      spaceArmed' = spaceArmed,
      pointerArmed' = pointerArmed,
      requests' = requests,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = valueProp,
      requested' = requested,
      outcome' = "none",
      base' = base
    }
  }

  // prop change: aria-disabled. Disabling drops any pending press.
  action set_disabled = {
    nondet value = Set(true, false).oneOf()
    all {
      focused' = focused,
      disabled' = value,
      checked' = checked,
      enterToggles' = enterToggles,
      spaceArmed' = if (value) false else spaceArmed,
      pointerArmed' = if (value) false else pointerArmed,
      requests' = requests,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = valueProp,
      requested' = requested,
      outcome' = outcome,
      base' = base
    }
  }

  // prop change: the optional Enter key
  action set_enter_toggles = {
    nondet value = Set(true, false).oneOf()
    all {
      focused' = focused,
      disabled' = disabled,
      checked' = checked,
      enterToggles' = value,
      spaceArmed' = spaceArmed,
      pointerArmed' = pointerArmed,
      requests' = requests,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = valueProp,
      requested' = requested,
      outcome' = outcome,
      base' = base
    }
  }

  action step = any {
    init,
    focus,
    blur,
    key_down,
    key_up,
    pointer_down,
    pointer_up,
    pointer_cancel,
    setValue,
    hostToggle,
    control,
    acceptRequests,
    seed,
    set_disabled,
    set_enter_toggles
  }

  // the state is binary: on or off, never mixed
  val CheckedIsBinary: bool = or(checked == "true", checked == "false")
  // aria-checked is always present, binary, and mirrors the state
  val AriaCheckedContract: bool = and(
    or(ariaChecked(checked) == "true", ariaChecked(checked) == "false"),
    (ariaChecked(checked) == "true") == (checked == "true")
  )
  // a pending Space press needs a focused, enabled switch
  val SpaceArmedImpliesFocusedEnabled: bool =
    or(not(spaceArmed), and(focused, not(disabled)))
  // a pending pointer press never survives disabling
  val PointerArmedImpliesEnabled: bool =
    or(not(pointerArmed), not(disabled))
  // controlled: only the value prop sets the state, so no event commits
  val ControlledFollowsProp: bool = or(not(controlled), checked == valueProp)
  // a rejected request leaves the state as it found it
  val RejectedRequestUntouched: bool = or(not(outcome == "rejected"), checked == base)
  // an accepted request committed exactly its intent
  val AcceptedRequestCommits: bool = or(not(outcome == "accepted"), checked == requested)
}
