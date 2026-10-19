// APG Disclosure (Show/Hide) — https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/
//
// One trigger (role=button) controls one panel. The spec models both the
// widget state (`expanded`) and what it renders (`ariaExpanded` on the trigger,
// `panelHidden` on the panel), so the central APG requirement — aria-expanded
// mirrors the panel's visibility — is a checkable invariant, not a comment.
//
// Events are the user-level alphabet shared with the scenario bridge:
//   focus / blur   the trigger gains / loses focus
//   click          pointer activation (focuses the trigger, then requests a toggle)
//   press          Enter or Space on the focused trigger (APG keyboard section)
//   expand/collapse/toggle  programmatic control (the same request path)
//   disable/enable   the trigger becomes inert (cannot gain focus, ignores
//                    click and keys). Focus it already held is browser-defined
//                    (Chromium keeps document.activeElement until the next key
//                    input), so the spec records it as "unknown" until the next
//                    focus / blur / click settles it
//
// Request vs commit (map ticket rt1p). Everything a user sees as a change —
// click, press, expand, collapse, toggle — is a *request* carrying an intent
// (`requested`). It fires onValueChange (`requests` counts the calls) when the
// intent differs from the current value, and then:
//   uncontrolled        the request is accepted: the state commits the intent
//   controlled, holds   the host ignores it ("rejected"): the state is untouched
//   controlled, accepts the host answers with the same value (`accepting`): the
//                       state commits through the controlled value, not the event
// The controlled value (`valueProp`) is the only thing that changes state while
// `controlled`; `setValue` / `hostToggle` are the host writing it. `control` and
// `acceptRequests` are configuration events (init is literal-only), like `disable`.
//
// Invariants for the model: ControlledFollowsProp (in controlled mode no event
// commits), RejectedRequestUntouched, AcceptedRequestCommits.
//
// `outcome` is "none" | "accepted" | "rejected" for the last request; a host
// write settles it back to "none". `base` is the value when it was received.
//
// ponytail: a single trigger/panel only; groups (DisclosureGroup, expandedKeys)
// need collections the generator does not have.
module apg_disclosure {
  import aria.* from "../../shared/aria"

  var expanded: bool      // widget state: the content is shown
  var disabled: bool      // the trigger is inert
  var focus: str          // "none" | "trigger" | "unknown"
  var ariaExpanded: str   // rendered aria-expanded on the trigger: "true" | "false"
  var panelHidden: bool   // rendered hidden attribute on the panel
  var requests: int       // number of requests that fired onValueChange
  var controlled: bool    // the host owns the value (`value` prop present)
  var accepting: bool     // controlled host that answers every request with its intent
  var valueProp: bool     // the controlled value prop (meaningful while controlled)
  var requested: bool     // intent of the last request
  var outcome: str        // "none" | "accepted" | "rejected"
  var base: bool          // value when the last request was received

  def moved(before: bool, after: bool): int = if (before == after) 0 else 1
  // controlled host that keeps the old value: the request is rejected
  def holds: bool = and(controlled, not(accepting))
  // controlled host that writes the intent back through the value prop
  def follows: bool = and(controlled, accepting)
  def verdict: str = if (holds) "rejected" else "accepted"
  // the value after a request for `want`
  def landed(h: bool, e: bool, want: bool): bool = if (h) e else want
  // the value prop after a request for `want`
  def propAfter(f: bool, p: bool, want: bool): bool = if (f) want else p

  action init = all {
    expanded' = false,
    disabled' = false,
    focus' = "none",
    ariaExpanded' = "false",
    panelHidden' = true,
    requests' = 0,
    controlled' = false,
    accepting' = false,
    valueProp' = false,
    requested' = false,
    outcome' = "none",
    base' = false
  }

  action focusTrigger = all {
    expanded' = expanded,
    disabled' = disabled,
    focus' = if (disabled) focus else "trigger",
    ariaExpanded' = ariaExpanded,
    panelHidden' = panelHidden,
    requests' = requests,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base
  }

  action blurTrigger = all {
    expanded' = expanded,
    disabled' = disabled,
    focus' = "none",
    ariaExpanded' = ariaExpanded,
    panelHidden' = panelHidden,
    requests' = requests,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base
  }

  // request: toggle, fired by a pointer click on an enabled trigger
  action click = all {
    expanded' = if (disabled) expanded else landed(holds, expanded, not(expanded)),
    disabled' = disabled,
    focus' = if (disabled) focus else "trigger",
    ariaExpanded' = if (disabled) ariaExpanded else ariaBoolToken(landed(holds, expanded, not(expanded))),
    panelHidden' = if (disabled) panelHidden else not(landed(holds, expanded, not(expanded))),
    requests' = if (disabled) requests else requests + 1,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = if (disabled) valueProp else propAfter(follows, valueProp, not(expanded)),
    requested' = if (disabled) requested else not(expanded),
    outcome' = if (disabled) outcome else verdict,
    base' = if (disabled) base else expanded
  }

  // request: toggle, fired by Enter / Space on the focused, enabled trigger
  action press = all {
    expanded' = if (and(not(disabled), focus == "trigger")) landed(holds, expanded, not(expanded)) else expanded,
    disabled' = disabled,
    focus' = focus,
    ariaExpanded' = if (and(not(disabled), focus == "trigger")) ariaBoolToken(landed(holds, expanded, not(expanded))) else ariaExpanded,
    panelHidden' = if (and(not(disabled), focus == "trigger")) not(landed(holds, expanded, not(expanded))) else panelHidden,
    requests' = if (and(not(disabled), focus == "trigger")) requests + 1 else requests,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = if (and(not(disabled), focus == "trigger")) propAfter(follows, valueProp, not(expanded)) else valueProp,
    requested' = if (and(not(disabled), focus == "trigger")) not(expanded) else requested,
    outcome' = if (and(not(disabled), focus == "trigger")) verdict else outcome,
    base' = if (and(not(disabled), focus == "trigger")) expanded else base
  }

  // request: expand (a redundant request fires nothing)
  action expand = all {
    expanded' = if (expanded) expanded else landed(holds, expanded, true),
    disabled' = disabled,
    focus' = focus,
    ariaExpanded' = if (expanded) ariaExpanded else ariaBoolToken(landed(holds, expanded, true)),
    panelHidden' = if (expanded) panelHidden else not(landed(holds, expanded, true)),
    requests' = requests + moved(expanded, true),
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = if (expanded) valueProp else propAfter(follows, valueProp, true),
    requested' = if (expanded) requested else true,
    outcome' = if (expanded) outcome else verdict,
    base' = if (expanded) base else expanded
  }

  // request: collapse (a redundant request fires nothing)
  action collapse = all {
    expanded' = if (expanded) landed(holds, expanded, false) else expanded,
    disabled' = disabled,
    focus' = focus,
    ariaExpanded' = if (expanded) ariaBoolToken(landed(holds, expanded, false)) else ariaExpanded,
    panelHidden' = if (expanded) not(landed(holds, expanded, false)) else panelHidden,
    requests' = requests + moved(expanded, false),
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = if (expanded) propAfter(follows, valueProp, false) else valueProp,
    requested' = if (expanded) false else requested,
    outcome' = if (expanded) verdict else outcome,
    base' = if (expanded) expanded else base
  }

  // request: toggle, the programmatic API (ignores `disabled`)
  action toggle = all {
    expanded' = landed(holds, expanded, not(expanded)),
    disabled' = disabled,
    focus' = focus,
    ariaExpanded' = ariaBoolToken(landed(holds, expanded, not(expanded))),
    panelHidden' = not(landed(holds, expanded, not(expanded))),
    requests' = requests + 1,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = propAfter(follows, valueProp, not(expanded)),
    requested' = not(expanded),
    outcome' = verdict,
    base' = expanded
  }

  // commit: the host writes the controlled value (a no-op while uncontrolled)
  action setValue = {
    nondet v = Set(true, false).oneOf()
    all {
      expanded' = if (controlled) v else expanded,
      disabled' = disabled,
      focus' = focus,
      ariaExpanded' = if (controlled) ariaBoolToken(v) else ariaExpanded,
      panelHidden' = if (controlled) not(v) else panelHidden,
      requests' = requests,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = if (controlled) v else valueProp,
      requested' = requested,
      outcome' = if (controlled) "none" else outcome,
      base' = base
    }
  }

  // commit: the host flips its own copy of the value (an outside button)
  action hostToggle = all {
    expanded' = if (controlled) not(valueProp) else expanded,
    disabled' = disabled,
    focus' = focus,
    ariaExpanded' = if (controlled) ariaBoolToken(not(valueProp)) else ariaExpanded,
    panelHidden' = if (controlled) valueProp else panelHidden,
    requests' = requests,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = if (controlled) not(valueProp) else valueProp,
    requested' = requested,
    outcome' = if (controlled) "none" else outcome,
    base' = base
  }

  // configuration: the host starts owning the value, adopting the current one
  action control = all {
    expanded' = expanded,
    disabled' = disabled,
    focus' = focus,
    ariaExpanded' = ariaExpanded,
    panelHidden' = panelHidden,
    requests' = requests,
    controlled' = true,
    accepting' = accepting,
    valueProp' = expanded,
    requested' = requested,
    outcome' = outcome,
    base' = base
  }

  // configuration: the controlled host answers every request with its intent
  action acceptRequests = all {
    expanded' = expanded,
    disabled' = disabled,
    focus' = focus,
    ariaExpanded' = ariaExpanded,
    panelHidden' = panelHidden,
    requests' = requests,
    controlled' = controlled,
    accepting' = true,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base
  }

  action disable = all {
    expanded' = expanded,
    disabled' = true,
    focus' = if (focus == "trigger") "unknown" else focus,
    ariaExpanded' = ariaExpanded,
    panelHidden' = panelHidden,
    requests' = requests,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base
  }

  action enable = all {
    expanded' = expanded,
    disabled' = false,
    focus' = focus,
    ariaExpanded' = ariaExpanded,
    panelHidden' = panelHidden,
    requests' = requests,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base
  }

  action step = any {
    init, focusTrigger, blurTrigger, click, press, expand, collapse, toggle,
    setValue, hostToggle, control, acceptRequests, disable, enable
  }

  // APG: aria-expanded is "true" exactly when the panel is visible
  val AriaMirrorsPanel: bool = (ariaExpanded == "true") == not(panelHidden)
  // the rendered attributes always follow the widget state
  val RenderFollowsState: bool = (ariaExpanded == "true") == expanded
  // an inert trigger is never *known* to hold focus
  val DisabledNotFocused: bool = or(not(disabled), not(focus == "trigger"))
  // focus is one of the modelled positions
  val FocusKnown: bool = or(focus == "none", or(focus == "trigger", focus == "unknown"))
  // callbacks only ever count up from zero
  val RequestsNonNegative: bool = requests >= 0
  // controlled: only the value prop sets the state, so no event commits
  val ControlledFollowsProp: bool = or(not(controlled), expanded == valueProp)
  // a rejected request leaves the state as it found it
  val RejectedRequestUntouched: bool = or(not(outcome == "rejected"), expanded == base)
  // an accepted request committed exactly its intent
  val AcceptedRequestCommits: bool = or(not(outcome == "accepted"), expanded == requested)
}
