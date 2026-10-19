// WAI-ARIA APG — Slider pattern (single thumb).
//
// Modelled (https://www.w3.org/WAI/ARIA/apg/patterns/slider/):
//   - "Keyboard Interaction": Right/Up Arrow +1 step, Left/Down Arrow -1 step,
//     Home -> first allowed value, End -> last allowed value, PageUp/PageDown
//     (optional) +/- a large step. Keys act only while the thumb has focus
//     ("Focus is placed on the slider ... also known as the thumb").
//   - "Note 2": reversing the arrow direction. Modelled as the RTL rule: in a
//     horizontal slider under dir=rtl, Left Arrow increases and Right Arrow
//     decreases; Up/Down never flip. In a vertical slider Left/Right keep their
//     LTR meaning (APG lists all four arrows for the vertical temperature
//     example), so orientation only changes the RTL rule and aria-orientation.
//   - "WAI-ARIA Roles, States, and Properties": role=slider, aria-valuenow,
//     aria-valuemin, aria-valuemax, aria-valuetext, aria-orientation
//     (default horizontal), as derived defs of the state.
//   - Examples (slider-color-viewer, slider-temperature, slider-rating,
//     slider-seek): the range 0..10 stands in for all four; `valueText` is the
//     aria-valuetext hook (a low/medium/high band, like the rating example's
//     "Very Dissatisfied ... Very Satisfied").
//   - Configuration variants (bean qtmy): `configure` remounts the widget with
//     a packed variant int, because init is literal-only and the generator
//     allows one nondet per action. Variant 0 is step 1 / large step 3 / value
//     5; variant 1 is step 2 / large step 4 / value 6 (large step on the grid,
//     so a page jump never leaves it). The range stays 0..10 so one walk
//     alphabet is valid for every variant and a step that does not divide the
//     range is still a deliberate omission.
//
// Request vs commit (map ticket rt1p). A key or a rail press is a *request*
// carrying an intent (`requested`); it fires onValueChange (`requests` counts
// the calls) when the intent differs from the current value, and then:
//   uncontrolled        the request is accepted: the value commits the intent
//   controlled, holds   the host ignores it ("rejected"): the value is untouched
//   controlled, accepts the host answers with the same value (`accepting`): the
//                       value commits through the controlled prop, not the event
// `valueProp` is the only thing that changes the value while `controlled`;
// `setValue` / `hostToggle` are the host writing it. `control` / `acceptRequests`
// are configuration events (init is literal-only). Invariants for the model:
// ControlledFollowsProp (no event commits while controlled),
// RejectedRequestUntouched, AcceptedRequestCommits.
//
// Deliberate omissions (ponytail: ceilings, not bugs):
//   - aria-label / aria-labelledby (labelling is a rendering concern).
//   - Non-integer values and a step that does not divide the range: the range
//     is 0..10 and every variant's step divides it, so `End` and a pointer
//     press always land on the grid.
//   - Dragging (pointer capture, move events): only a discrete pointer
//     "press at value" is modelled, snapped to the step grid and clamped.
//   - Disabled / read-only, touch assistive-technology key synthesis, and
//     aria-valuetext formatting (units, locale): a real widget formats the text
//     from its own value; the spec only fixes WHEN the text is derived (always,
//     from valuenow).
//   - The range (0..10) is fixed; `configure` varies step, large step and the
//     starting value. The bridge rejects a config outside the variant table.
module apg_slider {
  import aria.* from "../../shared/aria"

  var flavor: int         // configuration variant (0 | 1), see `configure`
  var value: int          // the current value (aria-valuenow)
  var focused: bool       // the thumb has keyboard focus
  var orientation: str    // "horizontal" | "vertical"
  var dir: str            // "ltr" | "rtl"
  var handled: bool       // the last key was consumed (preventDefault)
  var controlled: bool    // the host owns the value (`value` prop present)
  var accepting: bool     // controlled host that answers every request with its intent
  var valueProp: int      // the controlled value prop (meaningful while controlled)
  var requested: int      // intent of the last request
  var outcome: str        // "none" | "accepted" | "rejected"
  var base: int           // value when the last request was received
  var requests: int       // number of requests that fired onValueChange

  // --- configuration -----------------------------------------------------
  def rangeMin: int = 0
  def rangeMax: int = 10
  // packed variant (0 | 1); see the header and `configure`
  def variantSmallStep(v: int): int = if (v == 1) 2 else 1
  def variantLargeStep(v: int): int = if (v == 1) 4 else 3
  def variantStart(v: int): int = if (v == 1) 6 else 5
  def smallStep: int = variantSmallStep(flavor)
  def largeStep: int = variantLargeStep(flavor)

  // --- pure behaviour ----------------------------------------------------
  def clamp(v: int): int =
    if (v < rangeMin) rangeMin else if (v > rangeMax) rangeMax else v

  // a raw pointer position lands on the nearest step (the widget corrects an
  // off-grid press; APG's Home/End name "first/last allowed value")
  def snap(v: int): int =
    rangeMin + ((v - rangeMin + smallStep / 2) / smallStep) * smallStep

  def pointerValue(raw: int): int = clamp(snap(raw))

  // signed change for a key; 0 for keys that do not change by a delta
  // (arrows and RTL mirroring: shared/aria.qnt ariaValueArrow)
  def keyDelta(k: str, o: str, d: str): int =
    if (k == "PageUp") largeStep
    else if (k == "PageDown") -largeStep
    else smallStep * ariaValueArrow(k, o, d)

  def isHandledKey(k: str): bool =
    or(k == "Home", k == "End", keyDelta(k, "horizontal", "ltr") != 0)

  def nextValue(v: int, k: str, o: str, d: str): int =
    if (k == "Home") rangeMin
    else if (k == "End") rangeMax
    else clamp(v + keyDelta(k, o, d))

  def valueTextFor(v: int): str =
    if (v <= 3) "low" else if (v <= 7) "medium" else "high"

  // --- request / commit (map ticket rt1p) ----------------------------------
  def moved(before: int, after: int): int = if (before == after) 0 else 1
  // a focused key that would land somewhere else is a request; an inert key
  // (delta 0, or a Home/End already at the bound) is not
  def wants(f: bool, current: int, want: int): bool = and(f, want != current)
  def willRequest(f: bool, k: str, v: int, o: str, d: str): bool =
    wants(f, v, nextValue(v, k, o, d))
  // controlled host that keeps the old value: the request is rejected
  def holds: bool = and(controlled, not(accepting))
  // controlled host that writes the intent back through the value prop
  def follows: bool = and(controlled, accepting)
  def verdict: str = if (holds) "rejected" else "accepted"
  // the value after a request for `want`
  def landed(h: bool, current: int, want: int): int = if (h) current else want
  // the value prop after a request for `want`
  def propAfter(f: bool, p: int, want: int): int = if (f) want else p

  // --- ARIA contract (derived from the state) -----------------------------
  def ariaRole: str = "slider"
  def ariaValueNow: int = value
  def ariaValueMin: int = rangeMin
  def ariaValueMax: int = rangeMax
  def ariaValueText: str = valueTextFor(value)
  def ariaOrientation: str = orientation
  def tabIndex: int = 0

  // --- machine -----------------------------------------------------------
  action init = all {
    flavor' = 0,
    value' = 5,
    focused' = false,
    orientation' = "horizontal",
    dir' = "ltr",
    handled' = false,
    controlled' = false,
    accepting' = false,
    valueProp' = 5,
    requested' = 5,
    outcome' = "none",
    base' = 5,
    requests' = 0
  }

  action focus = all {
    flavor' = flavor,
    value' = value,
    focused' = true,
    orientation' = orientation,
    dir' = dir,
    handled' = false,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  action blur = all {
    flavor' = flavor,
    value' = value,
    focused' = false,
    orientation' = orientation,
    dir' = dir,
    handled' = false,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  // request: a focused key moves the value (APG keyboard section)
  action keydown = {
    nondet key = Set(
      "ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown",
      "Home", "End", "PageUp", "PageDown", "Enter"
    ).oneOf()
    all {
      flavor' = flavor,
      value' = if (and(focused, isHandledKey(key))) landed(holds, value, nextValue(value, key, orientation, dir)) else value,
      focused' = focused,
      orientation' = orientation,
      dir' = dir,
      handled' = and(focused, isHandledKey(key)),
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = if (willRequest(focused, key, value, orientation, dir)) propAfter(follows, valueProp, nextValue(value, key, orientation, dir)) else valueProp,
      requested' = if (willRequest(focused, key, value, orientation, dir)) nextValue(value, key, orientation, dir) else requested,
      outcome' = if (willRequest(focused, key, value, orientation, dir)) verdict else outcome,
      base' = if (willRequest(focused, key, value, orientation, dir)) value else base,
      requests' = if (willRequest(focused, key, value, orientation, dir)) requests + 1 else requests
    }
  }

  // request: pointer press on the track at a raw value; focuses the thumb, clamps
  action pointer = {
    nondet raw = Set(-3, 0, 4, 7, 10, 14).oneOf()
    all {
      flavor' = flavor,
      value' = landed(holds, value, pointerValue(raw)),
      focused' = true,
      orientation' = orientation,
      dir' = dir,
      handled' = false,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = propAfter(follows, valueProp, pointerValue(raw)),
      requested' = if (wants(true, value, pointerValue(raw))) pointerValue(raw) else requested,
      outcome' = if (wants(true, value, pointerValue(raw))) verdict else outcome,
      base' = if (wants(true, value, pointerValue(raw))) value else base,
      requests' = if (wants(true, value, pointerValue(raw))) requests + 1 else requests
    }
  }

  action setOrientation = {
    nondet o = Set("horizontal", "vertical").oneOf()
    all {
      flavor' = flavor,
      value' = value,
      focused' = focused,
      orientation' = o,
      dir' = dir,
      handled' = false,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = valueProp,
      requested' = requested,
      outcome' = outcome,
      base' = base,
      requests' = requests
    }
  }

  action setDir = {
    nondet d = Set("ltr", "rtl").oneOf()
    all {
      flavor' = flavor,
      value' = value,
      focused' = focused,
      orientation' = orientation,
      dir' = d,
      handled' = false,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = valueProp,
      requested' = requested,
      outcome' = outcome,
      base' = base,
      requests' = requests
    }
  }

  // commit: the host writes the controlled value (a no-op while uncontrolled)
  // a host write is a value on the step grid (0..10 is even for both variants)
  action setValue = {
    nondet v = Set(0, 2, 4, 6, 8, 10).oneOf()
    all {
      flavor' = flavor,
      value' = if (controlled) v else value,
      focused' = focused,
      orientation' = orientation,
      dir' = dir,
      handled' = false,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = if (controlled) v else valueProp,
      requested' = requested,
      outcome' = if (controlled) "none" else outcome,
      base' = base,
      requests' = requests
    }
  }

  // commit: the host flips its own copy of the value between the range ends
  // (an outside two-state control)
  action hostToggle = all {
    flavor' = flavor,
    value' = if (controlled) (if (valueProp == rangeMax) rangeMin else rangeMax) else value,
    focused' = focused,
    orientation' = orientation,
    dir' = dir,
    handled' = false,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = if (controlled) (if (valueProp == rangeMax) rangeMin else rangeMax) else valueProp,
    requested' = requested,
    outcome' = if (controlled) "none" else outcome,
    base' = base,
    requests' = requests
  }

  // configuration: the host starts owning the value, adopting the current one
  action control = all {
    flavor' = flavor,
    value' = value,
    focused' = focused,
    orientation' = orientation,
    dir' = dir,
    handled' = false,
    controlled' = true,
    accepting' = accepting,
    valueProp' = value,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  // configuration: the controlled host answers every request with its intent
  action acceptRequests = all {
    flavor' = flavor,
    value' = value,
    focused' = focused,
    orientation' = orientation,
    dir' = dir,
    handled' = false,
    controlled' = controlled,
    accepting' = true,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  // configuration: remount with a packed variant (step, large step, start).
  // Resets the widget to uncontrolled and horizontal/ltr, like a fresh mount.
  action configure = {
    nondet variant = Set(0, 1).oneOf()
    all {
      flavor' = variant,
      value' = variantStart(variant),
      focused' = false,
      orientation' = "horizontal",
      dir' = "ltr",
      handled' = false,
      controlled' = false,
      accepting' = false,
      valueProp' = variantStart(variant),
      requested' = variantStart(variant),
      outcome' = "none",
      base' = variantStart(variant),
      requests' = 0
    }
  }

  action step = any {
    init, configure, focus, blur, keydown, pointer, setOrientation, setDir,
    setValue, hostToggle, control, acceptRequests
  }

  // --- invariants --------------------------------------------------------
  // min <= value <= max
  val ValueInRange: bool = and(value >= rangeMin, value <= rangeMax)
  // the exposed aria-valuenow sits inside the exposed [valuemin, valuemax]
  val AriaNowWithinBounds: bool =
    and(ariaValueMin <= ariaValueNow, ariaValueNow <= ariaValueMax)
  // every reachable value is on the step grid
  val ValueOnStepGrid: bool = (value - rangeMin) % smallStep == 0
  // aria-valuetext is always present and the endpoints read as the extremes
  val ValueTextDerived: bool = and(
    ariaValueText != "",
    or(value != rangeMin, ariaValueText == "low"),
    or(value != rangeMax, ariaValueText == "high")
  )
  // aria-orientation is one of the two ARIA tokens; direction is ltr/rtl
  val OrientationAndDirValid: bool = and(
    ariaOrientationKnown(ariaOrientation),
    or(dir == "ltr", dir == "rtl")
  )
  // a key is only consumed while the thumb has focus
  val HandledImpliesFocused: bool = or(not(handled), focused)
  // the slider thumb is always in the tab sequence
  val InTabSequence: bool = and(ariaRole == "slider", tabIndex == 0)
  // callbacks only ever count up from zero
  val RequestsNonNegative: bool = requests >= 0
  // controlled: only the value prop sets the state, so no event commits
  val ControlledFollowsProp: bool = or(not(controlled), value == valueProp)
  // a rejected request leaves the state as it found it
  val RejectedRequestUntouched: bool = or(not(outcome == "rejected"), value == base)
  // an accepted request committed exactly its intent
  val AcceptedRequestCommits: bool = or(not(outcome == "accepted"), value == requested)
}
