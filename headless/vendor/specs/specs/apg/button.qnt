// WAI-ARIA APG — Button pattern (command button + toggle button).
//
// Modelled from https://www.w3.org/WAI/ARIA/apg/patterns/button/ :
//   - "About This Pattern": ordinary button and toggle button (aria-pressed)
//   - "Keyboard Interaction": Space and Enter activate the button; focus stays
//     on the button after activation (no context change is modelled)
//   - "WAI-ARIA Roles, States, and Properties": role=button, aria-disabled
//     when the action is unavailable, aria-pressed true/false on a toggle
// and the Button Examples (https://www.w3.org/WAI/ARIA/apg/patterns/button/examples/button/):
// Enter activates on keydown, Space is armed on keydown and activates on keyup
// (the native <button> behaviour), so releasing Space after a blur does nothing.
//
// Attribute contract (derived from state, never stored):
//   role          = "button"
//   aria-pressed  = "true" | "false" on a toggle, absent on a command button
//   aria-disabled = "true" when disabled, absent otherwise
// A disabled button stays focusable (aria-disabled, not the native attribute)
// but never activates.
//
// Request vs commit (map ticket rt1p). A toggle's activation is a *request*
// carrying the new pressed state (`requested`); it fires onPressedChange
// (`requests` counts the calls) when the intent differs from the current value,
// and then:
//   uncontrolled        the request is accepted: the state commits the intent
//   controlled, holds   the host ignores it ("rejected"): the state is untouched
//   controlled, accepts the host answers with the same value (`accepting`): the
//                       state commits through the controlled value, not the event
// A command button's activation is not a value request: it only counts
// (`activations`). The controlled value (`valueProp`) is the only thing that
// changes state while `controlled`; `setValue` / `hostToggle` are the host
// writing it. `control` / `acceptRequests` are configuration events, `seed`
// plants an initial value without counting as a request.
//
// Invariants for the model: ControlledFollowsProp (in controlled mode no event
// commits), RejectedRequestUntouched, AcceptedRequestCommits.
//
// `outcome` is "none" | "accepted" | "rejected" for the last request; a host
// write settles it back to "none". `base` is the value when it was received.
//
// Deliberate omissions:
//   - accessible name / aria-labelledby / aria-describedby (static wiring, no state)
//   - post-activation focus management (dialog open/close, wizard step, shortcut keys)
//   - menu button (aria-haspopup) — owned by the menu-button pattern
//   - partially pressed (mixed) toggle: only the true/false values the button page lists
//   - Enter key repeat, native `disabled`, and pointer-capture details
module apg_button {
  import aria.* from "../../shared/aria"

  var focused: bool       // the button has keyboard focus
  var disabled: bool      // aria-disabled: focusable, never activates
  var isToggle: bool      // config: toggle button (aria-pressed) vs command button
  var pressed: bool       // toggle state; always false on a command button
  var toggleCount: int    // committed flips since it became a toggle
  var spaceArmed: bool    // Space went down on the focused button, awaiting keyup
  var pointerArmed: bool  // pointer went down on the button, awaiting release
  var activations: int    // onPress callbacks fired (what the consumer observes)
  var requests: int       // onPressedChange callbacks fired by user input
  var controlled: bool    // the host owns the pressed value (`value` prop present)
  var accepting: bool     // controlled host that answers every request with its intent
  var valueProp: bool     // the controlled value prop (meaningful while controlled)
  var requested: bool     // intent of the last request
  var outcome: str        // "none" | "accepted" | "rejected"
  var base: bool          // value when the last request was received

  // guards: the generator supports no preconditions, so they live in the RHS
  def enterFires(focused: bool, disabled: bool, key: str): bool =
    and(focused, not(disabled), key == "Enter")
  def spaceArms(focused: bool, disabled: bool, key: str): bool =
    and(focused, not(disabled), key == "Space")
  def spaceReleaseFires(armed: bool, disabled: bool, key: str): bool =
    and(armed, not(disabled), key == "Space")
  def pointerReleaseFires(armed: bool, disabled: bool): bool =
    and(armed, not(disabled))

  def b2i(b: bool): int = if (b) 1 else 0
  def moved(before: bool, after: bool): int = if (before == after) 0 else 1

  // ARIA attribute contract
  def ariaPressed(isToggle: bool, pressed: bool): str =
    if (isToggle) ariaBoolToken(pressed) else "absent"
  def ariaDisabled(disabled: bool): str =
    if (disabled) "true" else "absent"

  // request / commit (map ticket rt1p)
  def holds: bool = and(controlled, not(accepting))
  def follows: bool = and(controlled, accepting)
  def verdict: str = if (holds) "rejected" else "accepted"
  // the pressed value after a request for `want`
  def landed(h: bool, c: bool, want: bool): bool = if (h) c else want
  // the value prop after a request for `want`
  def propAfter(f: bool, p: bool, want: bool): bool = if (f) want else p

  action init = all {
    focused' = false,
    disabled' = false,
    isToggle' = false,
    pressed' = false,
    toggleCount' = 0,
    spaceArmed' = false,
    pointerArmed' = false,
    activations' = 0,
    requests' = 0,
    controlled' = false,
    accepting' = false,
    valueProp' = false,
    requested' = false,
    outcome' = "none",
    base' = false
  }

  action focus = all {
    focused' = true,
    disabled' = disabled,
    isToggle' = isToggle,
    pressed' = pressed,
    toggleCount' = toggleCount,
    spaceArmed' = spaceArmed,
    pointerArmed' = pointerArmed,
    activations' = activations,
    requests' = requests,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base
  }

  // blur cancels a pending Space press (keyup would land elsewhere)
  action blur = all {
    focused' = false,
    disabled' = disabled,
    isToggle' = isToggle,
    pressed' = pressed,
    toggleCount' = toggleCount,
    spaceArmed' = false,
    pointerArmed' = pointerArmed,
    activations' = activations,
    requests' = requests,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base
  }

  // Keyboard Interaction: Enter activates on keydown, Space arms until keyup.
  // "Other" stands for any key the pattern does not handle.
  action key_down = {
    nondet key = Set("Enter", "Space", "Other").oneOf()
    all {
      focused' = focused,
      disabled' = disabled,
      isToggle' = isToggle,
      pressed' = if (and(enterFires(focused, disabled, key), isToggle)) landed(holds, pressed, not(pressed)) else pressed,
      toggleCount' = if (and(enterFires(focused, disabled, key), isToggle)) toggleCount + moved(pressed, landed(holds, pressed, not(pressed))) else toggleCount,
      spaceArmed' = if (spaceArms(focused, disabled, key)) true else spaceArmed,
      pointerArmed' = pointerArmed,
      activations' = if (enterFires(focused, disabled, key)) activations + 1 else activations,
      requests' = if (and(enterFires(focused, disabled, key), isToggle)) requests + 1 else requests,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = if (and(enterFires(focused, disabled, key), isToggle)) propAfter(follows, valueProp, not(pressed)) else valueProp,
      requested' = if (and(enterFires(focused, disabled, key), isToggle)) not(pressed) else requested,
      outcome' = if (and(enterFires(focused, disabled, key), isToggle)) verdict else outcome,
      base' = if (and(enterFires(focused, disabled, key), isToggle)) pressed else base
    }
  }

  action key_up = {
    nondet key = Set("Enter", "Space", "Other").oneOf()
    all {
      focused' = focused,
      disabled' = disabled,
      isToggle' = isToggle,
      pressed' = if (and(spaceReleaseFires(spaceArmed, disabled, key), isToggle)) landed(holds, pressed, not(pressed)) else pressed,
      toggleCount' = if (and(spaceReleaseFires(spaceArmed, disabled, key), isToggle)) toggleCount + moved(pressed, landed(holds, pressed, not(pressed))) else toggleCount,
      spaceArmed' = if (key == "Space") false else spaceArmed,
      pointerArmed' = pointerArmed,
      activations' = if (spaceReleaseFires(spaceArmed, disabled, key)) activations + 1 else activations,
      requests' = if (and(spaceReleaseFires(spaceArmed, disabled, key), isToggle)) requests + 1 else requests,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = if (and(spaceReleaseFires(spaceArmed, disabled, key), isToggle)) propAfter(follows, valueProp, not(pressed)) else valueProp,
      requested' = if (and(spaceReleaseFires(spaceArmed, disabled, key), isToggle)) not(pressed) else requested,
      outcome' = if (and(spaceReleaseFires(spaceArmed, disabled, key), isToggle)) verdict else outcome,
      base' = if (and(spaceReleaseFires(spaceArmed, disabled, key), isToggle)) pressed else base
    }
  }

  // pointer down focuses the button (also when aria-disabled) and arms a click
  action pointer_down = all {
    focused' = true,
    disabled' = disabled,
    isToggle' = isToggle,
    pressed' = pressed,
    toggleCount' = toggleCount,
    spaceArmed' = spaceArmed,
    pointerArmed' = not(disabled),
    activations' = activations,
    requests' = requests,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base
  }

  // pointer released over the button: the click activates
  action pointer_up = all {
    focused' = focused,
    disabled' = disabled,
    isToggle' = isToggle,
    pressed' = if (and(pointerReleaseFires(pointerArmed, disabled), isToggle)) landed(holds, pressed, not(pressed)) else pressed,
    toggleCount' = if (and(pointerReleaseFires(pointerArmed, disabled), isToggle)) toggleCount + moved(pressed, landed(holds, pressed, not(pressed))) else toggleCount,
    spaceArmed' = spaceArmed,
    pointerArmed' = false,
    activations' = if (pointerReleaseFires(pointerArmed, disabled)) activations + 1 else activations,
    requests' = if (and(pointerReleaseFires(pointerArmed, disabled), isToggle)) requests + 1 else requests,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = if (and(pointerReleaseFires(pointerArmed, disabled), isToggle)) propAfter(follows, valueProp, not(pressed)) else valueProp,
    requested' = if (and(pointerReleaseFires(pointerArmed, disabled), isToggle)) not(pressed) else requested,
    outcome' = if (and(pointerReleaseFires(pointerArmed, disabled), isToggle)) verdict else outcome,
    base' = if (and(pointerReleaseFires(pointerArmed, disabled), isToggle)) pressed else base
  }

  // pointer left / cancelled before release: no click
  action pointer_cancel = all {
    focused' = focused,
    disabled' = disabled,
    isToggle' = isToggle,
    pressed' = pressed,
    toggleCount' = toggleCount,
    spaceArmed' = spaceArmed,
    pointerArmed' = false,
    activations' = activations,
    requests' = requests,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base
  }

  // commit: the host writes the controlled value (a no-op while uncontrolled)
  action setValue = {
    nondet v = Set(true, false).oneOf()
    all {
      focused' = focused,
      disabled' = disabled,
      isToggle' = isToggle,
      pressed' = if (and(controlled, isToggle)) v else pressed,
      toggleCount' = if (and(controlled, isToggle)) toggleCount + moved(pressed, v) else toggleCount,
      spaceArmed' = spaceArmed,
      pointerArmed' = pointerArmed,
      activations' = activations,
      requests' = requests,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = if (and(controlled, isToggle)) v else valueProp,
      requested' = requested,
      outcome' = if (controlled) "none" else outcome,
      base' = base
    }
  }

  // commit: the host flips its own copy of the value (an outside toggle)
  action hostToggle = all {
    focused' = focused,
    disabled' = disabled,
    isToggle' = isToggle,
    pressed' = if (and(controlled, isToggle)) not(valueProp) else pressed,
    toggleCount' = if (and(controlled, isToggle)) toggleCount + 1 else toggleCount,
    spaceArmed' = spaceArmed,
    pointerArmed' = pointerArmed,
    activations' = activations,
    requests' = requests,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = if (and(controlled, isToggle)) not(valueProp) else valueProp,
    requested' = requested,
    outcome' = if (controlled) "none" else outcome,
    base' = base
  }

  // configuration: the host starts owning the pressed value, adopting the current one
  action control = all {
    focused' = focused,
    disabled' = disabled,
    isToggle' = isToggle,
    pressed' = pressed,
    toggleCount' = toggleCount,
    spaceArmed' = spaceArmed,
    pointerArmed' = pointerArmed,
    activations' = activations,
    requests' = requests,
    controlled' = true,
    accepting' = accepting,
    valueProp' = pressed,
    requested' = requested,
    outcome' = outcome,
    base' = base
  }

  // configuration: the controlled host answers every request with its intent
  action acceptRequests = all {
    focused' = focused,
    disabled' = disabled,
    isToggle' = isToggle,
    pressed' = pressed,
    toggleCount' = toggleCount,
    spaceArmed' = spaceArmed,
    pointerArmed' = pointerArmed,
    activations' = activations,
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
    nondet v = Set(true, false).oneOf()
    all {
      focused' = focused,
      disabled' = disabled,
      isToggle' = isToggle,
      pressed' = if (controlled) pressed else (if (isToggle) v else pressed),
      toggleCount' = if (controlled) toggleCount else (if (isToggle) b2i(v) else toggleCount),
      spaceArmed' = spaceArmed,
      pointerArmed' = pointerArmed,
      activations' = activations,
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
      isToggle' = isToggle,
      pressed' = pressed,
      toggleCount' = toggleCount,
      spaceArmed' = if (value) false else spaceArmed,
      pointerArmed' = if (value) false else pointerArmed,
      activations' = activations,
      requests' = requests,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = valueProp,
      requested' = requested,
      outcome' = outcome,
      base' = base
    }
  }

  // prop change: command button <-> toggle button. A command button has no
  // pressed state, so leaving toggle mode resets it; a controlled toggle
  // re-adopts the value prop.
  action set_toggle = {
    nondet value = Set(true, false).oneOf()
    all {
      focused' = focused,
      disabled' = disabled,
      isToggle' = value,
      pressed' = if (value) (if (controlled) valueProp else pressed) else false,
      toggleCount' = if (value) (if (controlled) b2i(valueProp) else toggleCount) else 0,
      spaceArmed' = spaceArmed,
      pointerArmed' = pointerArmed,
      activations' = activations,
      requests' = requests,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = if (controlled) (if (value) valueProp else false) else valueProp,
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
    set_toggle
  }

  // aria-pressed is present exactly on a toggle button
  val PressedAttrPresentIffToggle: bool =
    (ariaPressed(isToggle, pressed) != "absent") == isToggle
  // ...and mirrors the pressed state
  val PressedAttrMirrorsState: bool =
    or(not(isToggle), (ariaPressed(isToggle, pressed) == "true") == pressed)
  // aria-disabled="true" exactly when disabled, otherwise absent
  val DisabledAttrContract: bool = and(
    (ariaDisabled(disabled) == "true") == disabled,
    (ariaDisabled(disabled) == "absent") == not(disabled)
  )
  // a command button never carries pressed state
  val CommandButtonNeverPressed: bool = or(isToggle, not(pressed))
  // pressed is the parity of the committed flips since toggle mode began
  val PressedIsToggleParity: bool = pressed == (toggleCount % 2 == 1)
  // a request only ever rides an activation
  val RequestsWithinActivations: bool = requests <= activations
  // a pending Space press needs a focused, enabled button
  val SpaceArmedImpliesFocusedEnabled: bool =
    or(not(spaceArmed), and(focused, not(disabled)))
  // a pending pointer press never survives disabling
  val PointerArmedImpliesEnabled: bool =
    or(not(pointerArmed), not(disabled))
  // controlled: only the value prop sets the state, so no event commits
  val ControlledFollowsProp: bool =
    or(not(controlled), or(not(isToggle), pressed == valueProp))
  // a rejected request leaves the state as it found it
  val RejectedRequestUntouched: bool = or(not(outcome == "rejected"), pressed == base)
  // an accepted request committed exactly its intent
  val AcceptedRequestCommits: bool = or(not(outcome == "accepted"), pressed == requested)
}
