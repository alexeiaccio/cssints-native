// WAI-ARIA APG — Checkbox pattern: one checkbox (dual-state, optionally tri-state).
//
// Modelled from https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/ :
//   - "About This Pattern": dual-state (checked / not checked) and tri-state
//     (adds partially checked) checkboxes
//   - "Keyboard Interaction": Space changes the state; Enter does nothing
//   - "WAI-ARIA Roles, States, and Properties": role=checkbox; aria-checked is
//     "true" / "false" / "mixed" (mixed only for a tri-state checkbox)
// and the Checkbox Examples (https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/examples/checkbox/):
// Space is armed on keydown and flips on keyup (the native checkbox behaviour).
// The group controller that derives "mixed" from its children is the separate
// machine specs/apg/checkbox-group.qnt.
//
// Attribute contract (derived from state, never stored):
//   role         = "checkbox"
//   aria-checked = "true" | "false" | "mixed"; "mixed" only when `allowMixed`
// Configuration variant: `allowMixed` (dual-state vs tri-state display).
// Activating a mixed checkbox checks it ("mixed" -> "true"), as the group
// controller does ("Checking the overall checkbox checks all options").
//
// Request vs commit (map ticket rt1p). A user activation — Space, a pointer
// click — is a *request* carrying the new state (`requested`); it fires
// onCheckedChange (`requests` counts the calls) and then:
//   uncontrolled        the request is accepted: the state commits the intent
//   controlled, holds   the host ignores it ("rejected"): the state is untouched
//   controlled, accepts the host answers with the same value (`accepting`): the
//                       state commits through the controlled value, not the event
// The controlled value (`valueProp`, possibly "mixed") is the only thing that
// changes state while `controlled`; `setValue` / `hostToggle` are the host
// writing it. `control` / `acceptRequests` are configuration events, `seed`
// plants an initial value (including "mixed") without counting as a request.
//
// Invariants for the model: ControlledFollowsProp (in controlled mode no event
// commits), RejectedRequestUntouched, AcceptedRequestCommits.
//
// `outcome` is "none" | "accepted" | "rejected" for the last request; a host
// write settles it back to "none". `base` is the value when it was received.
//
// Deliberate omissions:
//   - accessible name, aria-labelledby/aria-describedby, group wiring
//   - Enter key (the pattern lists Space only; modelled as a no-op)
//   - required / invalid / read-only (not part of the APG checkbox pattern)
//   - pointer-capture details
module apg_checkbox {
  var focused: bool       // the checkbox has keyboard focus
  var disabled: bool      // aria-disabled: focusable, never changes by user input
  var state: str          // "true" | "false" | "mixed"
  var allowMixed: bool    // config: tri-state checkbox (may display "mixed")
  var spaceArmed: bool    // Space went down on the focused checkbox, awaiting keyup
  var pointerArmed: bool  // pointer went down on the checkbox, awaiting release
  var requests: int       // onChange callbacks fired by user input (not by prop changes)
  var controlled: bool    // the host owns the value (`value` prop present)
  var accepting: bool     // controlled host that answers every request with its intent
  var valueProp: str      // the controlled value prop (meaningful while controlled)
  var requested: str      // intent of the last request
  var outcome: str        // "none" | "accepted" | "rejected"
  var base: str           // value when the last request was received

  // false -> true, true -> false, mixed -> true
  def nextState(state: str): str = if (state == "true") "false" else "true"

  def spaceArms(focused: bool, disabled: bool, key: str): bool =
    and(focused, not(disabled), key == "Space")
  def spaceReleaseFires(armed: bool, disabled: bool, key: str): bool =
    and(armed, not(disabled), key == "Space")
  def pointerReleaseFires(armed: bool, disabled: bool): bool =
    and(armed, not(disabled))

  // ARIA attribute contract: "mixed" is only exposed by a tri-state checkbox
  def ariaChecked(state: str, allowMixed: bool): str =
    if (state == "true") "true"
    else if (and(state == "mixed", allowMixed)) "mixed"
    else "false"

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
    state' = "false",
    allowMixed' = false,
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
    state' = state,
    allowMixed' = allowMixed,
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
    state' = state,
    allowMixed' = allowMixed,
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

  // only Space is handled on keydown (it arms); Enter and other keys do nothing
  action key_down = {
    nondet key = Set("Space", "Enter", "Other").oneOf()
    all {
      focused' = focused,
      disabled' = disabled,
      state' = state,
      allowMixed' = allowMixed,
      spaceArmed' = if (spaceArms(focused, disabled, key)) true else spaceArmed,
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

  // request: Space released on the focused, enabled checkbox
  action key_up = {
    nondet key = Set("Space", "Enter", "Other").oneOf()
    all {
      focused' = focused,
      disabled' = disabled,
      state' = if (spaceReleaseFires(spaceArmed, disabled, key)) landed(holds, state, nextState(state)) else state,
      allowMixed' = allowMixed,
      spaceArmed' = if (key == "Space") false else spaceArmed,
      pointerArmed' = pointerArmed,
      requests' = if (spaceReleaseFires(spaceArmed, disabled, key)) requests + 1 else requests,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = if (spaceReleaseFires(spaceArmed, disabled, key)) propAfter(follows, valueProp, nextState(state)) else valueProp,
      requested' = if (spaceReleaseFires(spaceArmed, disabled, key)) nextState(state) else requested,
      outcome' = if (spaceReleaseFires(spaceArmed, disabled, key)) verdict else outcome,
      base' = if (spaceReleaseFires(spaceArmed, disabled, key)) state else base
    }
  }

  action pointer_down = all {
    focused' = true,
    disabled' = disabled,
    state' = state,
    allowMixed' = allowMixed,
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

  // request: pointer released over the checkbox
  action pointer_up = all {
    focused' = focused,
    disabled' = disabled,
    state' = if (pointerReleaseFires(pointerArmed, disabled)) landed(holds, state, nextState(state)) else state,
    allowMixed' = allowMixed,
    spaceArmed' = spaceArmed,
    pointerArmed' = false,
    requests' = if (pointerReleaseFires(pointerArmed, disabled)) requests + 1 else requests,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = if (pointerReleaseFires(pointerArmed, disabled)) propAfter(follows, valueProp, nextState(state)) else valueProp,
    requested' = if (pointerReleaseFires(pointerArmed, disabled)) nextState(state) else requested,
    outcome' = if (pointerReleaseFires(pointerArmed, disabled)) verdict else outcome,
    base' = if (pointerReleaseFires(pointerArmed, disabled)) state else base
  }

  action pointer_cancel = all {
    focused' = focused,
    disabled' = disabled,
    state' = state,
    allowMixed' = allowMixed,
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
  // A dual-state checkbox rejects "mixed".
  action setValue = {
    nondet incoming = Set("true", "false", "mixed").oneOf()
    all {
      focused' = focused,
      disabled' = disabled,
      state' = if (and(controlled, or(not(incoming == "mixed"), allowMixed))) incoming else state,
      allowMixed' = allowMixed,
      spaceArmed' = spaceArmed,
      pointerArmed' = pointerArmed,
      requests' = requests,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = if (and(controlled, or(not(incoming == "mixed"), allowMixed))) incoming else valueProp,
      requested' = requested,
      outcome' = if (controlled) "none" else outcome,
      base' = base
    }
  }

  // commit: the host flips its own copy of the value (an outside checkbox)
  action hostToggle = all {
    focused' = focused,
    disabled' = disabled,
    state' = if (controlled) nextState(valueProp) else state,
    allowMixed' = allowMixed,
    spaceArmed' = spaceArmed,
    pointerArmed' = pointerArmed,
    requests' = requests,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = if (controlled) nextState(valueProp) else valueProp,
    requested' = requested,
    outcome' = if (controlled) "none" else outcome,
    base' = base
  }

  // configuration: the host starts owning the value, adopting the current one
  action control = all {
    focused' = focused,
    disabled' = disabled,
    state' = state,
    allowMixed' = allowMixed,
    spaceArmed' = spaceArmed,
    pointerArmed' = pointerArmed,
    requests' = requests,
    controlled' = true,
    accepting' = accepting,
    valueProp' = state,
    requested' = requested,
    outcome' = outcome,
    base' = base
  }

  // configuration: the controlled host answers every request with its intent
  action acceptRequests = all {
    focused' = focused,
    disabled' = disabled,
    state' = state,
    allowMixed' = allowMixed,
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

  // configuration: plant an initial value (including "mixed") without counting
  // as a request. Inert while controlled: only the value prop may move the state.
  action seed = {
    nondet incoming = Set("true", "false", "mixed").oneOf()
    all {
      focused' = focused,
      disabled' = disabled,
      state' = if (controlled) state else (if (and(incoming == "mixed", not(allowMixed))) state else incoming),
      allowMixed' = allowMixed,
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
      state' = state,
      allowMixed' = allowMixed,
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

  // prop change: dual-state <-> tri-state. Going dual-state resolves "mixed".
  action set_allow_mixed = {
    nondet value = Set(true, false).oneOf()
    all {
      focused' = focused,
      disabled' = disabled,
      state' = if (and(not(value), state == "mixed")) "false" else state,
      allowMixed' = value,
      spaceArmed' = spaceArmed,
      pointerArmed' = pointerArmed,
      requests' = requests,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = if (controlled) (if (and(not(value), valueProp == "mixed")) "false" else valueProp) else valueProp,
      requested' = requested,
      outcome' = "none",
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
    set_allow_mixed
  }

  val StateValid: bool = or(state == "true", or(state == "false", state == "mixed"))
  // a dual-state checkbox is never mixed
  val DualStateNeverMixed: bool = or(allowMixed, state != "mixed")
  // aria-checked is "mixed" exactly when the tri-state checkbox is partially checked
  val AriaCheckedContract: bool = and(
    (ariaChecked(state, allowMixed) == "mixed") == and(allowMixed, state == "mixed"),
    (ariaChecked(state, allowMixed) == "true") == (state == "true"),
    (ariaChecked(state, allowMixed) == "false") == (state == "false")
  )
  // a pending Space press needs a focused, enabled checkbox
  val SpaceArmedImpliesFocusedEnabled: bool =
    or(not(spaceArmed), and(focused, not(disabled)))
  // a pending pointer press never survives disabling
  val PointerArmedImpliesEnabled: bool =
    or(not(pointerArmed), not(disabled))
  // controlled: only the value prop sets the state, so no event commits
  val ControlledFollowsProp: bool = or(not(controlled), state == valueProp)
  // a rejected request leaves the state as it found it
  val RejectedRequestUntouched: bool = or(not(outcome == "rejected"), state == base)
  // an accepted request committed exactly its intent
  val AcceptedRequestCommits: bool = or(not(outcome == "accepted"), state == requested)
}
