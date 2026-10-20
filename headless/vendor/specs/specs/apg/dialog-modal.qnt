// APG Dialog (Modal) pattern — the layered modal-dialog stack.
//
// Source: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
//   sections: About This Pattern, Keyboard Interaction (+ Notes 1-3),
//   WAI-ARIA Roles, States, and Properties
//   example:  https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/dialog/
//   (four dialogs: Add Delivery Address -> Verification Result / Address Added
//   -> End of the Road; the dialog table below is that example's content).
//
// One page behind up to MAX_DEPTH stacked modal dialogs. Focus is a single
// encoded target `layer * 100 + position`: layer 0 is the page, layer k the
// k-th open dialog; position 0 is a static `tabindex=-1` element (only dialogs
// with a static start have one), positions 1..tabCount are the tab sequence.
//
// Modelled
//   - open: activating an invoker moves focus INTO the new dialog, at the
//     dialog's configured initial focus (Keyboard Interaction, Note 1).
//   - Tab / Shift+Tab: move within the top dialog's tab sequence and wrap
//     first<->last; they never leave the dialog (focus trap). A static
//     `tabindex=-1` start element is focusable but not in the tab sequence.
//   - Escape: closes the top dialog only; focus returns to its invoker
//     (Note 2), popping one layer of the nested stack.
//   - activate (Enter/Space on the focused element): open a nested dialog,
//     close the top dialog, or replace it (Add: the Address Added dialog
//     replaces Add Delivery Address and inherits its return-focus target).
//   - focus_attempt: programmatic focus / pointer click on any element; the
//     trap refuses targets outside the top dialog (the dialog container itself
//     is never focusable) and focus stays put.
//   - pointer_outside: a click on the inert content; a no-op unless the
//     CLOSE_ON_OUTSIDE variant is enabled ("in some implementations, attempts
//     to interact with the inert content cause the dialog to close").
//   - remove_invoker: the invoking element no longer exists; the return
//     target becomes a logical-workflow fallback element (Note 2).
//   - ARIA contract (derived defs): role=dialog, aria-modal=true, accessible
//     name via aria-labelledby or aria-label, optional aria-describedby, and
//     the inert state of every layer beneath the top.
//
// Request vs commit (map ticket rt1p). Whether any dialog is open is the
// controlled value: `escape`, `activate` and `pointer_outside` are requests
// carrying the open intent (`requested`). A request fires onValueChange
// (`requests` counts the calls) when the intent differs from the current open
// state, and then:
//   uncontrolled        the request is accepted: the stack commits the intent
//   controlled, holds   the host ignores it ("rejected"): the stack is untouched
//   controlled, accepts the host writes the intent back (`accepting`)
// `valueProp` is the host's copy (meaningful while `controlled`); `setValue` /
// `hostToggle` are the host writing it, the only commit while controlled.
// `control` / `acceptRequests` configure the host (init is literal-only). A
// rejected open/close request leaves the whole stack (depth, layers, return
// targets, focus) untouched.
//
// Invariants for the model: ControlledFollowsProp (in controlled mode no event
// commits), RejectedRequestUntouched, AcceptedRequestCommits.
//
// Deliberately omitted
//   - the "work-flow design" exception that returns focus to a different
//     element than the invoker (only the invoker-removed fallback is modelled);
//   - the visible close-button recommendation (Note 3) is modelled as content
//     of the example dialogs, not enforced as an invariant;
//   - legacy `aria-hidden` handling of the inert layer, visual dimming, and
//     page scrolling;
//   - window blur/focus and focus escaping into browser chrome;
//   - dialog 2's aria-describedby/static-start advice interplay (the config
//     records what the example does, no invariant forbids the combination);
//   - the Alert Dialog variant: see alertdialog.qnt.
module apg_dialog_modal {
  var depth: int // number of open dialogs: 0 = page only .. MAX_DEPTH
  var l1: int // dialog id open at layer 1 (0 = none)
  var l2: int
  var l3: int
  var r1: int // focus target to restore when layer 1 closes (0 = unused)
  var r2: int
  var r3: int
  var focus: int // layer * 100 + position
  var requests: int // number of requests that fired onValueChange
  var controlled: bool // the host owns the open state (`value` prop present)
  var accepting: bool // controlled host that answers every request with its intent
  var valueProp: bool // the controlled value prop (meaningful while controlled)
  var requested: bool // intent of the last request
  var outcome: str // "none" | "accepted" | "rejected"
  var base: bool // open state when the last request was received

  // --- configuration: variants as constants and tables -----------------------
  def MAX_DEPTH: int = 3
  def CLOSE_ON_OUTSIDE: bool = false

  // tab-sequence length per dialog id (0 = the page: invoker, link, fallback)
  def tabCount(d: int): int =
    if (d == 0) 3
    else if (d == 1) 8 // street, city, state, zip, instructions, Verify, Add, Cancel
    else if (d == 2) 2 // help link, Close (the first paragraph is the static start)
    else if (d == 3) 2 // profile link, OK
    else 1 // Close
  // a `tabindex=-1` static element at the start of the dialog (position 0)
  def hasStatic(d: int): bool = d == 2
  // initial focus per dialog (Keyboard Interaction, Note 1)
  def initialFocus(d: int): int =
    if (d == 1) 1 // first input
    else if (d == 2) 0 // first paragraph: first interactive element is out of view
    else if (d == 3) 2 // OK, the most used control
    else 1 // sole focusable element
  // dialog opened by activating position `pos` of dialog `d` (0 = none)
  def opens(d: int, pos: int): int =
    if (and(d == 0, pos == 1)) 1 // Add Delivery Address button
    else if (and(d == 1, pos == 6)) 2 // Verify Address
    else if (and(d == 1, pos == 7)) 3 // Add (replaces dialog 1)
    else if (and(d == 2, pos == 1)) 4 // link to help
    else if (and(d == 3, pos == 1)) 4 // profile link
    else 0
  // activating position `pos` of dialog `d` closes it
  def closes(d: int, pos: int): bool =
    or(
      and(d == 1, or(pos == 7, pos == 8)),
      and(d == 2, pos == 2),
      and(d == 3, pos == 2),
      and(d == 4, pos == 1)
    )
  // fallback focus when the invoker is gone: page 3, otherwise first tabbable
  def fallbackPos(d: int): int = if (d == 0) 3 else 1

  // --- ARIA contract of a dialog id ------------------------------------------
  def dialogRole(d: int): str = "dialog"
  def ariaModal(d: int): bool = true
  // aria-labelledby vs aria-label: the example labels every dialog by title
  def labelling(d: int): str = "labelledby"
  def hasAccessibleName(d: int): bool =
    or(labelling(d) == "labelledby", labelling(d) == "label")
  // optional; the example omits it from dialog 1 (no static descriptive text)
  def ariaDescribedBy(d: int): bool = d != 1
  def contractOk(d: int): bool =
    and(dialogRole(d) == "dialog", ariaModal(d), hasAccessibleName(d))
  // every layer beneath the top is inert; so is the page once a dialog is open
  def isInert(layer: int): bool = layer < depth

  // --- derived state ---------------------------------------------------------
  def dlgAt(layer: int): int =
    if (layer == 1) l1 else if (layer == 2) l2 else if (layer == 3) l3 else 0
  def retAt(layer: int): int =
    if (layer == 1) r1 else if (layer == 2) r2 else if (layer == 3) r3 else 0
  def topDialog: int = dlgAt(depth)
  def topRet: int = retAt(depth)
  def focusLayer: int = focus / 100
  def focusPos: int = focus % 100

  def validPos(d: int, pos: int): bool =
    if (d == 0) and(pos >= 1, pos <= tabCount(0))
    else and(pos <= tabCount(d), or(pos >= 1, and(pos == 0, hasStatic(d))))
  def validTarget(target: int): bool =
    and(target / 100 == depth, validPos(topDialog, target % 100))
  def nextPos(pos: int, n: int): int = if (pos >= n) 1 else pos + 1
  def prevPos(pos: int, n: int): int = if (pos <= 1) n else pos - 1

  // --- transition kernel -----------------------------------------------------
  // ev: 1 escape, 2 activate, 3 pointer_outside, 4 tab, 5 shift_tab,
  //     6 focus_attempt, 7 remove_invoker
  // mode: 0 none, 1 close top, 2 open nested, 3 replace top
  def activateOpens: int = opens(topDialog, focusPos)
  def activateCloses: bool = closes(topDialog, focusPos)
  def activateMode: int =
    if (and(activateOpens > 0, activateCloses)) 3
    else if (and(activateOpens > 0, depth < MAX_DEPTH)) 2
    else if (activateCloses) 1
    else 0
  def modeOf(ev: int): int =
    if (ev == 1) (if (depth > 0) 1 else 0)
    else if (ev == 2) activateMode
    else if (ev == 3) (if (and(CLOSE_ON_OUTSIDE, depth > 0)) 1 else 0)
    else 0
  def newDlg(ev: int): int = if (ev == 2) activateOpens else 0

  def nextDepth(ev: int): int =
    if (modeOf(ev) == 1) depth - 1
    else if (modeOf(ev) == 2) depth + 1
    else depth
  def nextL(k: int, cur: int, ev: int): int =
    if (and(modeOf(ev) == 1, depth == k)) 0
    else if (and(modeOf(ev) == 2, depth + 1 == k)) newDlg(ev)
    else if (and(modeOf(ev) == 3, depth == k)) newDlg(ev)
    else cur
  def nextR(k: int, cur: int, ev: int): int =
    if (and(modeOf(ev) == 1, depth == k)) 0
    else if (and(modeOf(ev) == 2, depth + 1 == k)) focus
    else if (and(ev == 7, and(depth > 0, depth == k))) (k - 1) * 100 + fallbackPos(dlgAt(k - 1))
    else cur
  def nextFocus(ev: int, arg: int): int =
    if (modeOf(ev) == 1) topRet
    else if (modeOf(ev) == 2) (depth + 1) * 100 + initialFocus(newDlg(ev))
    else if (modeOf(ev) == 3) depth * 100 + initialFocus(newDlg(ev))
    else if (ev == 4) depth * 100 + nextPos(focusPos, tabCount(topDialog))
    else if (ev == 5) depth * 100 + prevPos(focusPos, tabCount(topDialog))
    else if (and(ev == 6, validTarget(arg))) arg
    else focus

  // --- request / commit (map ticket rt1p) ----------------------------------
  def moved(a: bool, b: bool): int = if (a == b) 0 else 1
  def holds: bool = and(controlled, not(accepting))
  def follows: bool = and(controlled, accepting)
  def verdict: str = if (holds) "rejected" else "accepted"
  def landed(h: bool, v: bool, want: bool): bool = if (h) v else want
  def propAfter(f: bool, p: bool, want: bool): bool = if (f) want else p
  // the open state is "any dialog is open"; only a change of it is a request
  def openNow: bool = depth > 0
  def wantOpenEscape: bool = nextDepth(1) > 0
  def wantOpenActivate: bool = nextDepth(2) > 0
  def wantOpenOutside: bool = nextDepth(3) > 0
  def rejectEscape: bool = and(holds, wantOpenEscape != openNow)
  def rejectActivate: bool = and(holds, wantOpenActivate != openNow)
  def rejectOutside: bool = and(holds, wantOpenOutside != openNow)

  // --- host writes (the only commit while controlled) ----------------------
  def setDepth(c: bool, v: bool, d: int): int =
    if (c) (if (v) (if (d > 0) d else 1) else 0) else d
  def openingSet(c: bool, v: bool, d: int): bool = and(c, and(v, d == 0))
  def closingSet(c: bool, v: bool, d: int): bool = and(c, and(not(v), d > 0))
  def toggleDepth(c: bool, d: int): int = if (c) (if (d > 0) 0 else 1) else d

  action init = all {
    depth' = 0,
    l1' = 0,
    l2' = 0,
    l3' = 0,
    r1' = 0,
    r2' = 0,
    r3' = 0,
    focus' = 1,
    requests' = 0,
    controlled' = false,
    accepting' = false,
    valueProp' = false,
    requested' = false,
    outcome' = "none",
    base' = false
  }

  // request: Escape closes the top dialog only
  action escape = all {
    depth' = if (rejectEscape) depth else nextDepth(1),
    l1' = if (rejectEscape) l1 else nextL(1, l1, 1),
    l2' = if (rejectEscape) l2 else nextL(2, l2, 1),
    l3' = if (rejectEscape) l3 else nextL(3, l3, 1),
    r1' = if (rejectEscape) r1 else nextR(1, r1, 1),
    r2' = if (rejectEscape) r2 else nextR(2, r2, 1),
    r3' = if (rejectEscape) r3 else nextR(3, r3, 1),
    focus' = if (rejectEscape) focus else nextFocus(1, 0),
    requests' = requests + moved(openNow, wantOpenEscape),
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = propAfter(follows, valueProp, wantOpenEscape),
    requested' = if (openNow == wantOpenEscape) requested else wantOpenEscape,
    outcome' = if (openNow == wantOpenEscape) outcome else verdict,
    base' = if (openNow == wantOpenEscape) base else openNow
  }

  // request: activate opens a nested dialog, closes the top, or replaces it
  action activate = all {
    depth' = if (rejectActivate) depth else nextDepth(2),
    l1' = if (rejectActivate) l1 else nextL(1, l1, 2),
    l2' = if (rejectActivate) l2 else nextL(2, l2, 2),
    l3' = if (rejectActivate) l3 else nextL(3, l3, 2),
    r1' = if (rejectActivate) r1 else nextR(1, r1, 2),
    r2' = if (rejectActivate) r2 else nextR(2, r2, 2),
    r3' = if (rejectActivate) r3 else nextR(3, r3, 2),
    focus' = if (rejectActivate) focus else nextFocus(2, 0),
    requests' = requests + moved(openNow, wantOpenActivate),
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = propAfter(follows, valueProp, wantOpenActivate),
    requested' = if (openNow == wantOpenActivate) requested else wantOpenActivate,
    outcome' = if (openNow == wantOpenActivate) outcome else verdict,
    base' = if (openNow == wantOpenActivate) base else openNow
  }

  // request: a click on the inert content (only acts with CLOSE_ON_OUTSIDE)
  action pointer_outside = all {
    depth' = if (rejectOutside) depth else nextDepth(3),
    l1' = if (rejectOutside) l1 else nextL(1, l1, 3),
    l2' = if (rejectOutside) l2 else nextL(2, l2, 3),
    l3' = if (rejectOutside) l3 else nextL(3, l3, 3),
    r1' = if (rejectOutside) r1 else nextR(1, r1, 3),
    r2' = if (rejectOutside) r2 else nextR(2, r2, 3),
    r3' = if (rejectOutside) r3 else nextR(3, r3, 3),
    focus' = if (rejectOutside) focus else nextFocus(3, 0),
    requests' = requests + moved(openNow, wantOpenOutside),
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = propAfter(follows, valueProp, wantOpenOutside),
    requested' = if (openNow == wantOpenOutside) requested else wantOpenOutside,
    outcome' = if (openNow == wantOpenOutside) outcome else verdict,
    base' = if (openNow == wantOpenOutside) base else openNow
  }

  action tab = all {
    depth' = nextDepth(4),
    l1' = nextL(1, l1, 4),
    l2' = nextL(2, l2, 4),
    l3' = nextL(3, l3, 4),
    r1' = nextR(1, r1, 4),
    r2' = nextR(2, r2, 4),
    r3' = nextR(3, r3, 4),
    focus' = nextFocus(4, 0),
    requests' = requests,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base
  }

  action shift_tab = all {
    depth' = nextDepth(5),
    l1' = nextL(1, l1, 5),
    l2' = nextL(2, l2, 5),
    l3' = nextL(3, l3, 5),
    r1' = nextR(1, r1, 5),
    r2' = nextR(2, r2, 5),
    r3' = nextR(3, r3, 5),
    focus' = nextFocus(5, 0),
    requests' = requests,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base
  }

  // pointer click / programmatic focus on any encoded target (valid or not)
  action focus_attempt = {
    nondet target = Set(0, 1, 3, 4, 100, 101, 102, 106, 108, 109, 200, 201, 202, 203, 300, 301, 302).oneOf()
    all {
      depth' = nextDepth(6),
      l1' = nextL(1, l1, 6),
      l2' = nextL(2, l2, 6),
      l3' = nextL(3, l3, 6),
      r1' = nextR(1, r1, 6),
      r2' = nextR(2, r2, 6),
      r3' = nextR(3, r3, 6),
      focus' = nextFocus(6, target),
      requests' = requests,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = valueProp,
      requested' = requested,
      outcome' = outcome,
      base' = base
    }
  }

  action remove_invoker = all {
    depth' = nextDepth(7),
    l1' = nextL(1, l1, 7),
    l2' = nextL(2, l2, 7),
    l3' = nextL(3, l3, 7),
    r1' = nextR(1, r1, 7),
    r2' = nextR(2, r2, 7),
    r3' = nextR(3, r3, 7),
    focus' = nextFocus(7, 0),
    requests' = requests,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base
  }

  // commit: the host writes the controlled open state (a no-op while uncontrolled)
  action setValue = {
    nondet v = Set(true, false).oneOf()
    all {
      depth' = if (controlled) setDepth(true, v, depth) else depth,
      l1' = if (openingSet(controlled, v, depth)) 1
        else if (closingSet(controlled, v, depth)) 0 else l1,
      l2' = if (closingSet(controlled, v, depth)) 0 else l2,
      l3' = if (closingSet(controlled, v, depth)) 0 else l3,
      r1' = if (openingSet(controlled, v, depth)) 1
        else if (closingSet(controlled, v, depth)) 0 else r1,
      r2' = if (closingSet(controlled, v, depth)) 0 else r2,
      r3' = if (closingSet(controlled, v, depth)) 0 else r3,
      focus' = if (openingSet(controlled, v, depth)) (100 + initialFocus(1))
        else if (closingSet(controlled, v, depth)) 1 else focus,
      requests' = requests,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = if (controlled) (setDepth(true, v, depth) > 0) else valueProp,
      requested' = requested,
      outcome' = if (controlled) "none" else outcome,
      base' = base
    }
  }

  // commit: the host flips its own copy of the open state
  action hostToggle = all {
    depth' = if (controlled) toggleDepth(true, depth) else depth,
    l1' = if (openingSet(controlled, not(openNow), depth)) 1
      else if (closingSet(controlled, not(openNow), depth)) 0 else l1,
    l2' = if (closingSet(controlled, not(openNow), depth)) 0 else l2,
    l3' = if (closingSet(controlled, not(openNow), depth)) 0 else l3,
    r1' = if (openingSet(controlled, not(openNow), depth)) 1
      else if (closingSet(controlled, not(openNow), depth)) 0 else r1,
    r2' = if (closingSet(controlled, not(openNow), depth)) 0 else r2,
    r3' = if (closingSet(controlled, not(openNow), depth)) 0 else r3,
    focus' = if (openingSet(controlled, not(openNow), depth)) (100 + initialFocus(1))
      else if (closingSet(controlled, not(openNow), depth)) 1 else focus,
    requests' = requests,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = if (controlled) (toggleDepth(true, depth) > 0) else valueProp,
    requested' = requested,
    outcome' = if (controlled) "none" else outcome,
    base' = base
  }

  // configuration: the host starts owning the open state, adopting the current one
  action control = all {
    depth' = depth,
    l1' = l1,
    l2' = l2,
    l3' = l3,
    r1' = r1,
    r2' = r2,
    r3' = r3,
    focus' = focus,
    requests' = requests,
    controlled' = true,
    accepting' = accepting,
    valueProp' = openNow,
    requested' = requested,
    outcome' = outcome,
    base' = base
  }

  // configuration: the controlled host answers every request with its intent
  action acceptRequests = all {
    depth' = depth,
    l1' = l1,
    l2' = l2,
    l3' = l3,
    r1' = r1,
    r2' = r2,
    r3' = r3,
    focus' = focus,
    requests' = requests,
    controlled' = controlled,
    accepting' = true,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base
  }

  action step = any {
    init, escape, activate, pointer_outside, tab, shift_tab, focus_attempt,
    remove_invoker, setValue, hostToggle, control, acceptRequests
  }

  // --- invariants ------------------------------------------------------------
  // focus never leaves the top modal while it is open (page when none is)
  val FocusInTopLayer: bool = focusLayer == depth
  // nothing beneath the top layer holds focus (aria-modal: those layers are inert)
  val NoFocusInInertLayer: bool = not(isInert(focusLayer))
  // focus sits on a real element; the dialog container itself is never focused
  val FocusPositionValid: bool = validPos(topDialog, focusPos)
  val DepthBounded: bool = and(depth >= 0, depth <= MAX_DEPTH)
  // exactly layers 1..depth hold a dialog and a return target; the rest are empty
  val StackContiguous: bool = and(
    or(and(depth >= 1, l1 > 0), and(depth < 1, l1 == 0, r1 == 0)),
    or(and(depth >= 2, l2 > 0), and(depth < 2, l2 == 0, r2 == 0)),
    or(and(depth >= 3, l3 > 0), and(depth < 3, l3 == 0, r3 == 0))
  )
  // each open layer's return target is a real element in the layer beneath it
  val ReturnTargetsValid: bool = and(
    or(depth < 1, and(r1 / 100 == 0, validPos(dlgAt(0), r1 % 100))),
    or(depth < 2, and(r2 / 100 == 1, validPos(dlgAt(1), r2 % 100))),
    or(depth < 3, and(r3 / 100 == 2, validPos(dlgAt(2), r3 % 100)))
  )
  // role=dialog, aria-modal=true and an accessible name on every open dialog
  val OpenDialogsHonourContract: bool = and(
    or(depth < 1, contractOk(l1)),
    or(depth < 2, contractOk(l2)),
    or(depth < 3, contractOk(l3))
  )
  // configuration sanity: every dialog's initial focus is a focusable position
  val InitialFocusConfigValid: bool = and(
    validPos(1, initialFocus(1)),
    validPos(2, initialFocus(2)),
    validPos(3, initialFocus(3)),
    validPos(4, initialFocus(4))
  )
  // callbacks only ever count up from zero
  val RequestsNonNegative: bool = requests >= 0
  // controlled: only the value prop sets the state, so no event commits
  val ControlledFollowsProp: bool = or(not(controlled), openNow == valueProp)
  // a rejected request leaves the state as it found it
  val RejectedRequestUntouched: bool = or(not(outcome == "rejected"), openNow == base)
  // an accepted request committed exactly its intent
  val AcceptedRequestCommits: bool = or(not(outcome == "accepted"), openNow == requested)
}
