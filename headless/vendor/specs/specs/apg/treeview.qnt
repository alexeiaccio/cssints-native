// APG Tree View — https://www.w3.org/WAI/ARIA/apg/patterns/treeview/
// (and the File Directory Treeview example, single/multi-select variants).
//
// Modelled APG sections:
//   * "Keyboard Interaction": Down/Up (next/previous *visible* node, collapsed
//     subtrees skipped), Right (open a closed parent, else move to its first
//     child, else nothing), Left (close an open parent, else move to the
//     parent, else nothing), Home/End (first / last visible node), Enter
//     (activate; opens/closes a parent), type-ahead (1-2 characters), `*`
//     (open every sibling of the focused node), and the multi-select keys
//     Space (toggle), Shift+Down / Shift+Up (move + toggle the arrived-at
//     node), Ctrl+A (select all; a second press clears).
//   * "WAI-ARIA Roles, States, and Properties": aria-expanded only on parent
//     nodes (absent on end nodes), aria-selected on every node,
//     aria-multiselectable on the tree, aria-level / aria-setsize /
//     aria-posinset on every treeitem, roving tabindex (exactly one tabbable
//     treeitem). These are derived defs (`ariaExpanded`, `ariaSelected`,
//     `ariaLevel`, `ariaSetsize`, `ariaPosinset`, `tabIndex`,
//     `ariaMultiselectable`), never stored vars, so they cannot drift from
//     the widget state.
//
// Request vs commit (map ticket rt1p). The controlled value of a tree view is the
// selected-node set; expansion stays uncontrolled (a `defaultExpanded` /
// `onExpandedChange` pair, like a menu's open state). Every user-intent event that
// changes the selection - Space, Enter (single-select), a click, Shift+Down /
// Shift+Up (multi), Ctrl+A (multi) - is a *request* carrying the intended
// `selected` mask (packed into `requested`). It fires onSelectionChange
// (`requests` counts the calls) when the intent differs from the current
// selection, and then:
//   uncontrolled        the request is accepted: the nodes commit the intent
//   controlled, holds   the host ignores it ("rejected"): the selection is untouched
//   controlled, accepts the host answers with the same value (`accepting`): the
//                       nodes commit through the controlled value, not the event
// The controlled value `selected` is spelled out per member (`valueProp0..6`, bit
// n-1 = node n) because the generator has no collections; it is the only thing
// that changes the selection while `controlled`, and `setValue` / `hostToggle` are
// the host writing it. `control` and `acceptRequests` are configuration events
// (init is literal-only). `configure` (the multi-select switch) resets the
// uncontrolled selection only. Expansion keys move focus and toggle expansion but
// do not change the controlled value, so they commit unconditionally.
//
// Invariants for the model: ControlledFollowsProp (in controlled mode no event
// commits the selection), RejectedRequestUntouched, AcceptedRequestCommits. The
// single-select invariant is scoped to the uncontrolled path: a controlled host
// owns the selection and may hand the tree any set.
//
// `outcome` is "none" | "accepted" | "rejected" for the last request; a host
// write settles it back to "none". `base` is the selection when the last request
// was received.
//
// Tree shape (a fixed constant, ids are pre-order = document order):
//
//   1 Projects            level 1, parent
//     2 Reports           level 2, parent
//       3 Roadmap         level 3, end node
//       4 Summary         level 3, end node
//     5 Notes             level 2, end node
//   6 Photos              level 1, parent
//     7 Trip              level 2, end node
//
// Encoding (the generator only supports str/int/bool vars): `expanded` and
// `selected` are bitmasks over node ids (bit n-1, weight 2^(n-1)); `focus` is
// the roving-tabindex node (always one of 1..7, even while the tree is not
// focused); `hasFocus` says whether DOM focus is inside the tree. Key events
// are no-ops while `hasFocus` is false. `ta1`/`ta2` are the type-ahead buffer
// ("" = empty). `activated` is the last node whose activation callback fired
// (0 = none).
//
// Deliberate omissions (ponytail):
//   * selection-follows-focus (single-select here selects on Enter/Space/click
//     only), Shift+Space / Ctrl+Shift+Home/End range selection (needs an
//     anchor), Ctrl+Arrow, Ctrl+click, and the "focus the first selected node
//     when the tree receives focus" rule (Tab returns to the roving node).
//   * type-ahead is capped at two characters (a third character restarts the
//     buffer), a repeated identical character does not cycle, and the timeout
//     is an explicit `typeaheadReset` event.
//   * trees deeper than 3 levels (visibility unrolls two ancestor checks),
//     dynamic/lazy children, the Navigation Treeview example (aria-current
//     links), aria-disabled nodes, and aria-owns/group wrappers.
//   * Ctrl+A selects every node (as the APG text says), including nodes inside
//     collapsed subtrees.
module apg_treeview {
  import aria.* from "../../shared/aria"

  var multi: bool       // aria-multiselectable
  var expanded: int     // bitmask: parent nodes whose children are shown
  var selected: int     // bitmask: aria-selected nodes
  var focus: int        // roving-tabindex node, 1..7
  var hasFocus: bool    // DOM focus is inside the tree
  var ta1: str          // type-ahead buffer, first character ("" = empty)
  var ta2: str          // type-ahead buffer, second character
  var activated: int    // last activated node, 0 = none
  var controlled: bool  // the host owns the selection (`value` prop present)
  var accepting: bool   // controlled host that answers every request with its intent
  var valueProp0: bool  // controlled selection member node 1, ...
  var valueProp1: bool
  var valueProp2: bool
  var valueProp3: bool
  var valueProp4: bool
  var valueProp5: bool
  var valueProp6: bool
  var requested: int    // intent of the last request, packed selection
  var outcome: str      // "none" | "accepted" | "rejected"
  var base: int         // selection when the last request was received
  var requests: int     // number of requests that fired onSelectionChange

  // ---- the constant tree --------------------------------------------------

  val lastNode: int = 7
  val allMask: int = 127

  def parentOf(n: int): int =
    if (n == 2) 1
    else if (n == 3) 2
    else if (n == 4) 2
    else if (n == 5) 1
    else if (n == 7) 6
    else 0

  def firstChild(n: int): int =
    if (n == 1) 2
    else if (n == 2) 3
    else if (n == 6) 7
    else 0

  def isParent(n: int): bool = firstChild(n) != 0

  // first two characters of each node's name, lowercased (for type-ahead)
  def label1(n: int): str =
    if (n == 1) "p"
    else if (n == 2) "r"
    else if (n == 3) "r"
    else if (n == 4) "s"
    else if (n == 5) "n"
    else if (n == 6) "p"
    else "t"

  def label2(n: int): str =
    if (n == 1) "r"
    else if (n == 2) "e"
    else if (n == 3) "o"
    else if (n == 4) "u"
    else if (n == 5) "o"
    else if (n == 6) "h"
    else "r"

  // ---- bitmask helpers ----------------------------------------------------

  def weight(n: int): int =
    if (n == 1) 1
    else if (n == 2) 2
    else if (n == 3) 4
    else if (n == 4) 8
    else if (n == 5) 16
    else if (n == 6) 32
    else if (n == 7) 64
    else 0

  def bit(mask: int, n: int): bool =
    if (and(n >= 1, n <= 7)) ((mask / weight(n)) % 2) == 1 else false

  def setBit(mask: int, n: int, on: bool): int =
    if (bit(mask, n) == on) mask
    else if (on) mask + weight(n)
    else mask - weight(n)

  def toggleBit(mask: int, n: int): int = setBit(mask, n, not(bit(mask, n)))

  def bitCount(mask: int, n: int): int = if (bit(mask, n)) 1 else 0

  def popcount(mask: int): int =
    bitCount(mask, 1) + bitCount(mask, 2) + bitCount(mask, 3) + bitCount(mask, 4)
      + bitCount(mask, 5) + bitCount(mask, 6) + bitCount(mask, 7)

  // ---- visibility and navigation -----------------------------------------

  // the node's parent is shown-open (roots, and the pseudo-parent 0, always are)
  def parentOpen(n: int, e: int): bool = or(parentOf(n) == 0, bit(e, parentOf(n)))

  // focusable: every ancestor is expanded (depth <= 3 => two ancestor checks)
  def visible(n: int, e: int): bool =
    and(n >= 1, n <= 7, parentOpen(n, e), parentOpen(parentOf(n), e))

  def visibleAfter(n: int, k: int, e: int): bool = and(n + k <= 7, visible(n + k, e))
  def visibleBefore(n: int, k: int, e: int): bool = and(n - k >= 1, visible(n - k, e))

  // Down: the next visible node in document order; the last node stays put
  def nextVisible(n: int, e: int): int =
    if (visibleAfter(n, 1, e)) n + 1
    else if (visibleAfter(n, 2, e)) n + 2
    else if (visibleAfter(n, 3, e)) n + 3
    else if (visibleAfter(n, 4, e)) n + 4
    else if (visibleAfter(n, 5, e)) n + 5
    else if (visibleAfter(n, 6, e)) n + 6
    else n

  // Up: the previous visible node; the first node stays put
  def prevVisible(n: int, e: int): int =
    if (visibleBefore(n, 1, e)) n - 1
    else if (visibleBefore(n, 2, e)) n - 2
    else if (visibleBefore(n, 3, e)) n - 3
    else if (visibleBefore(n, 4, e)) n - 4
    else if (visibleBefore(n, 5, e)) n - 5
    else if (visibleBefore(n, 6, e)) n - 6
    else n

  // End: the last node focusable without opening anything (node 1 is a root)
  def lastVisible(e: int): int =
    if (visible(7, e)) 7
    else if (visible(6, e)) 6
    else if (visible(5, e)) 5
    else if (visible(4, e)) 4
    else if (visible(3, e)) 3
    else if (visible(2, e)) 2
    else 1

  // Right on a closed parent opens it (focus stays); on an open parent focus
  // moves to its first child; on an end node nothing happens
  def rightExpands(f: int, e: int): bool = and(isParent(f), not(bit(e, f)))
  def rightTarget(f: int, e: int): int =
    if (and(isParent(f), bit(e, f))) firstChild(f) else f

  // Left on an open parent closes it (focus stays); otherwise focus moves to
  // the parent; on a root nothing happens
  def leftCollapses(f: int, e: int): bool = and(isParent(f), bit(e, f))
  def leftTarget(f: int, e: int): int =
    if (leftCollapses(f, e)) f
    else if (parentOf(f) == 0) f
    else parentOf(f)

  // `*`: open every parent that shares the focused node's parent
  def expandIfSibling(e: int, m: int, n: int): int =
    if (and(isParent(m), parentOf(m) == parentOf(n))) setBit(e, m, true) else e

  def expandSiblings(n: int, e: int): int =
    expandIfSibling(
      expandIfSibling(
        expandIfSibling(
          expandIfSibling(
            expandIfSibling(
              expandIfSibling(expandIfSibling(e, 1, n), 2, n), 3, n),
            4, n),
          5, n),
        6, n),
      7, n)

  // ---- type-ahead ---------------------------------------------------------

  // append `ch` to the buffer; a full buffer restarts with `ch`
  def nextC1(a: str, b: str, ch: str): str =
    if (a == "") ch else if (b == "") a else ch
  def nextC2(a: str, b: str, ch: str): str =
    if (a == "") "" else if (b == "") ch else ""

  def matches(n: int, c1: str, c2: str, e: int): bool =
    and(visible(n, e), label1(n) == c1, or(c2 == "", label2(n) == c2))

  // k-th candidate in cyclic id order starting at s (shared/aria.qnt)
  def cand(s: int, k: int): int = ariaCycle1(7, s, k)

  def firstMatch(s: int, c1: str, c2: str, e: int): int =
    if (matches(cand(s, 0), c1, c2, e)) cand(s, 0)
    else if (matches(cand(s, 1), c1, c2, e)) cand(s, 1)
    else if (matches(cand(s, 2), c1, c2, e)) cand(s, 2)
    else if (matches(cand(s, 3), c1, c2, e)) cand(s, 3)
    else if (matches(cand(s, 4), c1, c2, e)) cand(s, 4)
    else if (matches(cand(s, 5), c1, c2, e)) cand(s, 5)
    else if (matches(cand(s, 6), c1, c2, e)) cand(s, 6)
    else 0

  // one character searches from the node after focus; more characters search
  // from the focused node itself (so refining a match keeps focus on it)
  def typeStart(f: int, c2: str): int = ariaTaStart1(7, f, c2 == "")

  // 0 = no visible node matches (focus stays)
  def typeTarget(f: int, c1: str, c2: str, e: int): int =
    firstMatch(typeStart(f, c2), c1, c2, e)

  // ---- selection ----------------------------------------------------------

  def shiftMoves(f: int, e: int): bool = nextVisible(f, e) != f
  def shiftUpMoves(f: int, e: int): bool = prevVisible(f, e) != f

  // ---- request / commit (map ticket rt1p) ---------------------------------

  def holds: bool = and(controlled, not(accepting))
  def follows: bool = and(controlled, accepting)
  def verdict: str = if (holds) "rejected" else "accepted"
  // the selection after a request for `want`
  def landed(h: bool, current: int, want: int): int = if (h) current else want
  // a controlled member after a request for `want`
  def propAfter(f: bool, p: bool, want: bool): bool = if (f) want else p
  // the packed controlled value, spelled out one member at a time (node i+1)
  def propMask: int =
    (if (valueProp0) 1 else 0) + (if (valueProp1) 2 else 0)
    + (if (valueProp2) 4 else 0) + (if (valueProp3) 8 else 0)
    + (if (valueProp4) 16 else 0) + (if (valueProp5) 32 else 0)
    + (if (valueProp6) 64 else 0)
  // the selection component `i` (0..6) of a mask
  def at(mask: int, i: int): bool = bit(mask, i + 1)
  // a request is real only when its intent differs from the current selection
  def reqMoves(want: int): bool = want != selected
  // the intended selection of each request action
  def spaceWant: int =
    if (hasFocus) (if (multi) toggleBit(selected, focus) else weight(focus)) else selected
  def enterWant: int =
    if (and(hasFocus, not(multi))) weight(focus) else selected
  def shiftDownWant: int =
    if (and(hasFocus, multi, shiftMoves(focus, expanded)))
      toggleBit(selected, nextVisible(focus, expanded)) else selected
  def shiftUpWant: int =
    if (and(hasFocus, multi, shiftUpMoves(focus, expanded)))
      toggleBit(selected, prevVisible(focus, expanded)) else selected
  def ctrlAWant: int =
    if (and(hasFocus, multi)) (if (selected == allMask) 0 else allMask) else selected
  def clickWant(node: int): int =
    if (visible(node, expanded)) weight(node) else selected

  // ---- the ARIA contract (derived) ----------------------------------------

  // "none" means the attribute is absent (end nodes never carry aria-expanded)
  def ariaExpanded(n: int, e: int): str =
    if (not(isParent(n))) "none"
    else ariaBoolToken(bit(e, n))

  def ariaSelected(n: int, s: int): str = ariaBoolToken(bit(s, n))
  def ariaMultiselectable(m: bool): str = ariaBoolToken(m)

  def ariaLevel(n: int): int =
    if (parentOf(n) == 0) 1
    else if (parentOf(parentOf(n)) == 0) 2
    else 3

  def sibling(m: int, n: int): int = if (parentOf(m) == parentOf(n)) 1 else 0
  def siblingBefore(m: int, n: int): int = if (m < n) sibling(m, n) else 0

  def ariaSetsize(n: int): int =
    sibling(1, n) + sibling(2, n) + sibling(3, n) + sibling(4, n)
      + sibling(5, n) + sibling(6, n) + sibling(7, n)

  def ariaPosinset(n: int): int =
    1 + siblingBefore(1, n) + siblingBefore(2, n) + siblingBefore(3, n)
      + siblingBefore(4, n) + siblingBefore(5, n) + siblingBefore(6, n)
      + siblingBefore(7, n)

  // roving tabindex: 0 on the focus node, -1 elsewhere
  def tabIndex(n: int, f: int): int = if (n == f) 0 else -1
  def tabbable(n: int, f: int): int = if (tabIndex(n, f) == 0) 1 else 0
  def tabbableCount(f: int): int =
    tabbable(1, f) + tabbable(2, f) + tabbable(3, f) + tabbable(4, f)
      + tabbable(5, f) + tabbable(6, f) + tabbable(7, f)

  // ---- actions ------------------------------------------------------------

  action init = all {
    multi' = false,
    expanded' = 0,
    selected' = 0,
    focus' = 1,
    hasFocus' = false,
    ta1' = "",
    ta2' = "",
    activated' = 0,
    controlled' = false,
    accepting' = false,
    valueProp0' = false,
    valueProp1' = false,
    valueProp2' = false,
    valueProp3' = false,
    valueProp4' = false,
    valueProp5' = false,
    valueProp6' = false,
    requested' = 0,
    outcome' = "none",
    base' = 0,
    requests' = 0
  }

  // switch between single- and multi-select; the uncontrolled selection resets
  action configure = {
    nondet m = Set(true, false).oneOf()
    all {
      multi' = m,
      expanded' = expanded,
      selected' = if (controlled) selected else (if (m == multi) selected else 0),
      focus' = focus,
      hasFocus' = hasFocus,
      ta1' = "",
      ta2' = "",
      activated' = activated,
      controlled' = controlled,
      accepting' = accepting,
      valueProp0' = valueProp0,
      valueProp1' = valueProp1,
      valueProp2' = valueProp2,
      valueProp3' = valueProp3,
      valueProp4' = valueProp4,
      valueProp5' = valueProp5,
      valueProp6' = valueProp6,
      requested' = 0,
      outcome' = "none",
      base' = 0,
      requests' = requests
    }
  }

  // Tab into the tree: the roving node receives focus
  action focusTree = all {
    multi' = multi,
    expanded' = expanded,
    selected' = selected,
    focus' = focus,
    hasFocus' = true,
    ta1' = ta1,
    ta2' = ta2,
    activated' = activated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp0' = valueProp0,
    valueProp1' = valueProp1,
    valueProp2' = valueProp2,
    valueProp3' = valueProp3,
    valueProp4' = valueProp4,
    valueProp5' = valueProp5,
    valueProp6' = valueProp6,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  action blurTree = all {
    multi' = multi,
    expanded' = expanded,
    selected' = selected,
    focus' = focus,
    hasFocus' = false,
    ta1' = "",
    ta2' = "",
    activated' = activated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp0' = valueProp0,
    valueProp1' = valueProp1,
    valueProp2' = valueProp2,
    valueProp3' = valueProp3,
    valueProp4' = valueProp4,
    valueProp5' = valueProp5,
    valueProp6' = valueProp6,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  action pressDown = all {
    multi' = multi,
    expanded' = expanded,
    selected' = selected,
    focus' = if (hasFocus) nextVisible(focus, expanded) else focus,
    hasFocus' = hasFocus,
    ta1' = "",
    ta2' = "",
    activated' = activated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp0' = valueProp0,
    valueProp1' = valueProp1,
    valueProp2' = valueProp2,
    valueProp3' = valueProp3,
    valueProp4' = valueProp4,
    valueProp5' = valueProp5,
    valueProp6' = valueProp6,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  action pressUp = all {
    multi' = multi,
    expanded' = expanded,
    selected' = selected,
    focus' = if (hasFocus) prevVisible(focus, expanded) else focus,
    hasFocus' = hasFocus,
    ta1' = "",
    ta2' = "",
    activated' = activated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp0' = valueProp0,
    valueProp1' = valueProp1,
    valueProp2' = valueProp2,
    valueProp3' = valueProp3,
    valueProp4' = valueProp4,
    valueProp5' = valueProp5,
    valueProp6' = valueProp6,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  action pressRight = all {
    multi' = multi,
    expanded' = if (and(hasFocus, rightExpands(focus, expanded))) setBit(expanded, focus, true) else expanded,
    selected' = selected,
    focus' = if (hasFocus) rightTarget(focus, expanded) else focus,
    hasFocus' = hasFocus,
    ta1' = "",
    ta2' = "",
    activated' = activated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp0' = valueProp0,
    valueProp1' = valueProp1,
    valueProp2' = valueProp2,
    valueProp3' = valueProp3,
    valueProp4' = valueProp4,
    valueProp5' = valueProp5,
    valueProp6' = valueProp6,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  action pressLeft = all {
    multi' = multi,
    expanded' = if (and(hasFocus, leftCollapses(focus, expanded))) setBit(expanded, focus, false) else expanded,
    selected' = selected,
    focus' = if (hasFocus) leftTarget(focus, expanded) else focus,
    hasFocus' = hasFocus,
    ta1' = "",
    ta2' = "",
    activated' = activated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp0' = valueProp0,
    valueProp1' = valueProp1,
    valueProp2' = valueProp2,
    valueProp3' = valueProp3,
    valueProp4' = valueProp4,
    valueProp5' = valueProp5,
    valueProp6' = valueProp6,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  action pressHome = all {
    multi' = multi,
    expanded' = expanded,
    selected' = selected,
    focus' = if (hasFocus) 1 else focus,
    hasFocus' = hasFocus,
    ta1' = "",
    ta2' = "",
    activated' = activated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp0' = valueProp0,
    valueProp1' = valueProp1,
    valueProp2' = valueProp2,
    valueProp3' = valueProp3,
    valueProp4' = valueProp4,
    valueProp5' = valueProp5,
    valueProp6' = valueProp6,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  action pressEnd = all {
    multi' = multi,
    expanded' = expanded,
    selected' = selected,
    focus' = if (hasFocus) lastVisible(expanded) else focus,
    hasFocus' = hasFocus,
    ta1' = "",
    ta2' = "",
    activated' = activated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp0' = valueProp0,
    valueProp1' = valueProp1,
    valueProp2' = valueProp2,
    valueProp3' = valueProp3,
    valueProp4' = valueProp4,
    valueProp5' = valueProp5,
    valueProp6' = valueProp6,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  // request: Enter activates the focused node. A parent also opens/closes
  // (uncontrolled); in single-select the activated node becomes the selection.
  action pressEnter = all {
    multi' = multi,
    expanded' = if (and(hasFocus, isParent(focus))) toggleBit(expanded, focus) else expanded,
    selected' = landed(holds, selected, enterWant),
    focus' = focus,
    hasFocus' = hasFocus,
    ta1' = "",
    ta2' = "",
    activated' = if (hasFocus) focus else activated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp0' = propAfter(follows, valueProp0, at(enterWant, 0)),
    valueProp1' = propAfter(follows, valueProp1, at(enterWant, 1)),
    valueProp2' = propAfter(follows, valueProp2, at(enterWant, 2)),
    valueProp3' = propAfter(follows, valueProp3, at(enterWant, 3)),
    valueProp4' = propAfter(follows, valueProp4, at(enterWant, 4)),
    valueProp5' = propAfter(follows, valueProp5, at(enterWant, 5)),
    valueProp6' = propAfter(follows, valueProp6, at(enterWant, 6)),
    requested' = if (reqMoves(enterWant)) enterWant else requested,
    outcome' = if (reqMoves(enterWant)) verdict else outcome,
    base' = if (reqMoves(enterWant)) selected else base,
    requests' = if (reqMoves(enterWant)) requests + 1 else requests
  }

  // request: Space - single-select selects the focused node, multi-select toggles it
  action pressSpace = all {
    multi' = multi,
    expanded' = expanded,
    selected' = landed(holds, selected, spaceWant),
    focus' = focus,
    hasFocus' = hasFocus,
    ta1' = "",
    ta2' = "",
    activated' = activated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp0' = propAfter(follows, valueProp0, at(spaceWant, 0)),
    valueProp1' = propAfter(follows, valueProp1, at(spaceWant, 1)),
    valueProp2' = propAfter(follows, valueProp2, at(spaceWant, 2)),
    valueProp3' = propAfter(follows, valueProp3, at(spaceWant, 3)),
    valueProp4' = propAfter(follows, valueProp4, at(spaceWant, 4)),
    valueProp5' = propAfter(follows, valueProp5, at(spaceWant, 5)),
    valueProp6' = propAfter(follows, valueProp6, at(spaceWant, 6)),
    requested' = if (reqMoves(spaceWant)) spaceWant else requested,
    outcome' = if (reqMoves(spaceWant)) verdict else outcome,
    base' = if (reqMoves(spaceWant)) selected else base,
    requests' = if (reqMoves(spaceWant)) requests + 1 else requests
  }

  // `*`: open all siblings of the focused node (uncontrolled expansion)
  action pressStar = all {
    multi' = multi,
    expanded' = if (hasFocus) expandSiblings(focus, expanded) else expanded,
    selected' = selected,
    focus' = focus,
    hasFocus' = hasFocus,
    ta1' = "",
    ta2' = "",
    activated' = activated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp0' = valueProp0,
    valueProp1' = valueProp1,
    valueProp2' = valueProp2,
    valueProp3' = valueProp3,
    valueProp4' = valueProp4,
    valueProp5' = valueProp5,
    valueProp6' = valueProp6,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  // a printable character: type-ahead over the visible nodes
  action typeChar = {
    nondet ch = Set("p", "r", "n", "s", "t", "h", "e", "o", "u", "x").oneOf()
    all {
      multi' = multi,
      expanded' = expanded,
      selected' = selected,
      focus' = if (and(hasFocus, typeTarget(focus, nextC1(ta1, ta2, ch), nextC2(ta1, ta2, ch), expanded) != 0)) typeTarget(focus, nextC1(ta1, ta2, ch), nextC2(ta1, ta2, ch), expanded) else focus,
      hasFocus' = hasFocus,
      ta1' = if (hasFocus) nextC1(ta1, ta2, ch) else ta1,
      ta2' = if (hasFocus) nextC2(ta1, ta2, ch) else ta2,
      activated' = activated,
      controlled' = controlled,
      accepting' = accepting,
      valueProp0' = valueProp0,
      valueProp1' = valueProp1,
      valueProp2' = valueProp2,
      valueProp3' = valueProp3,
      valueProp4' = valueProp4,
      valueProp5' = valueProp5,
      valueProp6' = valueProp6,
      requested' = requested,
      outcome' = outcome,
      base' = base,
      requests' = requests
    }
  }

  // the type-ahead timeout elapsed
  action typeaheadReset = all {
    multi' = multi,
    expanded' = expanded,
    selected' = selected,
    focus' = focus,
    hasFocus' = hasFocus,
    ta1' = "",
    ta2' = "",
    activated' = activated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp0' = valueProp0,
    valueProp1' = valueProp1,
    valueProp2' = valueProp2,
    valueProp3' = valueProp3,
    valueProp4' = valueProp4,
    valueProp5' = valueProp5,
    valueProp6' = valueProp6,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  // request: Shift+Down - move to the next node and (multi) toggle its selection
  action pressShiftDown = all {
    multi' = multi,
    expanded' = expanded,
    selected' = landed(holds, selected, shiftDownWant),
    focus' = if (hasFocus) nextVisible(focus, expanded) else focus,
    hasFocus' = hasFocus,
    ta1' = "",
    ta2' = "",
    activated' = activated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp0' = propAfter(follows, valueProp0, at(shiftDownWant, 0)),
    valueProp1' = propAfter(follows, valueProp1, at(shiftDownWant, 1)),
    valueProp2' = propAfter(follows, valueProp2, at(shiftDownWant, 2)),
    valueProp3' = propAfter(follows, valueProp3, at(shiftDownWant, 3)),
    valueProp4' = propAfter(follows, valueProp4, at(shiftDownWant, 4)),
    valueProp5' = propAfter(follows, valueProp5, at(shiftDownWant, 5)),
    valueProp6' = propAfter(follows, valueProp6, at(shiftDownWant, 6)),
    requested' = if (reqMoves(shiftDownWant)) shiftDownWant else requested,
    outcome' = if (reqMoves(shiftDownWant)) verdict else outcome,
    base' = if (reqMoves(shiftDownWant)) selected else base,
    requests' = if (reqMoves(shiftDownWant)) requests + 1 else requests
  }

  // request: Shift+Up - move to the previous node and (multi) toggle its selection
  action pressShiftUp = all {
    multi' = multi,
    expanded' = expanded,
    selected' = landed(holds, selected, shiftUpWant),
    focus' = if (hasFocus) prevVisible(focus, expanded) else focus,
    hasFocus' = hasFocus,
    ta1' = "",
    ta2' = "",
    activated' = activated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp0' = propAfter(follows, valueProp0, at(shiftUpWant, 0)),
    valueProp1' = propAfter(follows, valueProp1, at(shiftUpWant, 1)),
    valueProp2' = propAfter(follows, valueProp2, at(shiftUpWant, 2)),
    valueProp3' = propAfter(follows, valueProp3, at(shiftUpWant, 3)),
    valueProp4' = propAfter(follows, valueProp4, at(shiftUpWant, 4)),
    valueProp5' = propAfter(follows, valueProp5, at(shiftUpWant, 5)),
    valueProp6' = propAfter(follows, valueProp6, at(shiftUpWant, 6)),
    requested' = if (reqMoves(shiftUpWant)) shiftUpWant else requested,
    outcome' = if (reqMoves(shiftUpWant)) verdict else outcome,
    base' = if (reqMoves(shiftUpWant)) selected else base,
    requests' = if (reqMoves(shiftUpWant)) requests + 1 else requests
  }

  // request: Ctrl+A (multi) selects every node; pressed again, clear
  action pressCtrlA = all {
    multi' = multi,
    expanded' = expanded,
    selected' = landed(holds, selected, ctrlAWant),
    focus' = focus,
    hasFocus' = hasFocus,
    ta1' = "",
    ta2' = "",
    activated' = activated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp0' = propAfter(follows, valueProp0, at(ctrlAWant, 0)),
    valueProp1' = propAfter(follows, valueProp1, at(ctrlAWant, 1)),
    valueProp2' = propAfter(follows, valueProp2, at(ctrlAWant, 2)),
    valueProp3' = propAfter(follows, valueProp3, at(ctrlAWant, 3)),
    valueProp4' = propAfter(follows, valueProp4, at(ctrlAWant, 4)),
    valueProp5' = propAfter(follows, valueProp5, at(ctrlAWant, 5)),
    valueProp6' = propAfter(follows, valueProp6, at(ctrlAWant, 6)),
    requested' = if (reqMoves(ctrlAWant)) ctrlAWant else requested,
    outcome' = if (reqMoves(ctrlAWant)) verdict else outcome,
    base' = if (reqMoves(ctrlAWant)) selected else base,
    requests' = if (reqMoves(ctrlAWant)) requests + 1 else requests
  }

  // request: pointer click on a node - only a visible node can be hit. It takes
  // focus, becomes the sole selection, is activated, and a parent toggles.
  action click = {
    nondet node = Set(1, 2, 3, 4, 5, 6, 7).oneOf()
    all {
      multi' = multi,
      expanded' = if (and(visible(node, expanded), isParent(node))) toggleBit(expanded, node) else expanded,
      selected' = landed(holds, selected, clickWant(node)),
      focus' = if (visible(node, expanded)) node else focus,
      hasFocus' = if (visible(node, expanded)) true else hasFocus,
      ta1' = "",
      ta2' = "",
      activated' = if (visible(node, expanded)) node else activated,
      controlled' = controlled,
      accepting' = accepting,
      valueProp0' = propAfter(follows, valueProp0, at(clickWant(node), 0)),
      valueProp1' = propAfter(follows, valueProp1, at(clickWant(node), 1)),
      valueProp2' = propAfter(follows, valueProp2, at(clickWant(node), 2)),
      valueProp3' = propAfter(follows, valueProp3, at(clickWant(node), 3)),
      valueProp4' = propAfter(follows, valueProp4, at(clickWant(node), 4)),
      valueProp5' = propAfter(follows, valueProp5, at(clickWant(node), 5)),
      valueProp6' = propAfter(follows, valueProp6, at(clickWant(node), 6)),
      requested' = if (reqMoves(clickWant(node))) clickWant(node) else requested,
      outcome' = if (reqMoves(clickWant(node))) verdict else outcome,
      base' = if (reqMoves(clickWant(node))) selected else base,
      requests' = if (reqMoves(clickWant(node))) requests + 1 else requests
    }
  }

  // commit: the host writes the controlled selection (a no-op while uncontrolled).
  // The pool is one node at a time: a host sets a single node or clears.
  action setValue = {
    nondet v = Set(0, 1, 2, 4, 8, 16, 32, 64).oneOf()
    all {
      multi' = multi,
      expanded' = expanded,
      selected' = if (controlled) v else selected,
      focus' = focus,
      hasFocus' = hasFocus,
      ta1' = ta1,
      ta2' = ta2,
      activated' = activated,
      controlled' = controlled,
      accepting' = accepting,
      valueProp0' = if (controlled) at(v, 0) else valueProp0,
      valueProp1' = if (controlled) at(v, 1) else valueProp1,
      valueProp2' = if (controlled) at(v, 2) else valueProp2,
      valueProp3' = if (controlled) at(v, 3) else valueProp3,
      valueProp4' = if (controlled) at(v, 4) else valueProp4,
      valueProp5' = if (controlled) at(v, 5) else valueProp5,
      valueProp6' = if (controlled) at(v, 6) else valueProp6,
      requested' = requested,
      outcome' = if (controlled) "none" else outcome,
      base' = base,
      requests' = requests
    }
  }

  // commit: the host flips one node of its own copy of the selection
  action hostToggle = {
    nondet n = Set(1, 2, 3, 4, 5, 6, 7).oneOf()
    all {
      multi' = multi,
      expanded' = expanded,
      selected' = if (controlled) toggleBit(propMask, n) else selected,
      focus' = focus,
      hasFocus' = hasFocus,
      ta1' = ta1,
      ta2' = ta2,
      activated' = activated,
      controlled' = controlled,
      accepting' = accepting,
      valueProp0' = if (and(controlled, n == 1)) not(valueProp0) else valueProp0,
      valueProp1' = if (and(controlled, n == 2)) not(valueProp1) else valueProp1,
      valueProp2' = if (and(controlled, n == 3)) not(valueProp2) else valueProp2,
      valueProp3' = if (and(controlled, n == 4)) not(valueProp3) else valueProp3,
      valueProp4' = if (and(controlled, n == 5)) not(valueProp4) else valueProp4,
      valueProp5' = if (and(controlled, n == 6)) not(valueProp5) else valueProp5,
      valueProp6' = if (and(controlled, n == 7)) not(valueProp6) else valueProp6,
      requested' = requested,
      outcome' = if (controlled) "none" else outcome,
      base' = base,
      requests' = requests
    }
  }

  // configuration: the host starts owning the selection, adopting the current nodes
  action control = all {
    multi' = multi,
    expanded' = expanded,
    selected' = selected,
    focus' = focus,
    hasFocus' = hasFocus,
    ta1' = ta1,
    ta2' = ta2,
    activated' = activated,
    controlled' = true,
    accepting' = accepting,
    valueProp0' = at(selected, 0),
    valueProp1' = at(selected, 1),
    valueProp2' = at(selected, 2),
    valueProp3' = at(selected, 3),
    valueProp4' = at(selected, 4),
    valueProp5' = at(selected, 5),
    valueProp6' = at(selected, 6),
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  // configuration: the controlled host answers every request with its intent
  action acceptRequests = all {
    multi' = multi,
    expanded' = expanded,
    selected' = selected,
    focus' = focus,
    hasFocus' = hasFocus,
    ta1' = ta1,
    ta2' = ta2,
    activated' = activated,
    controlled' = controlled,
    accepting' = true,
    valueProp0' = valueProp0,
    valueProp1' = valueProp1,
    valueProp2' = valueProp2,
    valueProp3' = valueProp3,
    valueProp4' = valueProp4,
    valueProp5' = valueProp5,
    valueProp6' = valueProp6,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  action step = any {
    init, configure, focusTree, blurTree,
    pressDown, pressUp, pressRight, pressLeft, pressHome, pressEnd,
    pressEnter, pressSpace, pressStar, typeChar, typeaheadReset,
    pressShiftDown, pressShiftUp, pressCtrlA, click,
    setValue, hostToggle, control, acceptRequests
  }

  // ---- invariants ---------------------------------------------------------

  // the roving node exists
  val FocusKnown: bool = and(focus >= 1, focus <= 7)
  // APG: focus only ever rests on a focusable node — every ancestor is open
  val FocusVisible: bool = visible(focus, expanded)
  // roving tabindex: exactly one treeitem has tabindex=0
  val ExactlyOneTabbable: bool = tabbableCount(focus) == 1
  // masks stay within the node set
  val MasksInRange: bool = and(expanded >= 0, expanded <= allMask, selected >= 0, selected <= allMask)

  def leafNeverOpen(n: int, e: int): bool = or(isParent(n), not(bit(e, n)))
  // end nodes are never recorded as expanded
  val LeafNeverExpanded: bool = and(
    leafNeverOpen(1, expanded), leafNeverOpen(2, expanded), leafNeverOpen(3, expanded),
    leafNeverOpen(4, expanded), leafNeverOpen(5, expanded), leafNeverOpen(6, expanded),
    leafNeverOpen(7, expanded)
  )

  // aria-expanded is rendered on exactly the parent nodes
  def ariaExpandedOnlyOnParent(n: int, e: int): bool =
    isParent(n) == (ariaExpanded(n, e) != "none")
  val AriaExpandedOnlyOnParents: bool = and(
    ariaExpandedOnlyOnParent(1, expanded), ariaExpandedOnlyOnParent(2, expanded),
    ariaExpandedOnlyOnParent(3, expanded), ariaExpandedOnlyOnParent(4, expanded),
    ariaExpandedOnlyOnParent(5, expanded), ariaExpandedOnlyOnParent(6, expanded),
    ariaExpandedOnlyOnParent(7, expanded)
  )

  // aria-level is one deeper than the parent's; posinset lies in 1..setsize
  def ariaPositionOk(n: int): bool =
    and(
      ariaLevel(n) == (if (parentOf(n) == 0) 1 else ariaLevel(parentOf(n)) + 1),
      ariaPosinset(n) >= 1,
      ariaPosinset(n) <= ariaSetsize(n)
    )
  val AriaPositionConsistent: bool = and(
    ariaPositionOk(1), ariaPositionOk(2), ariaPositionOk(3), ariaPositionOk(4),
    ariaPositionOk(5), ariaPositionOk(6), ariaPositionOk(7)
  )

  // a single-select tree never has more than one aria-selected node (uncontrolled:
  // a controlled host owns the selection and may hand us any set)
  val SingleSelectAtMostOne: bool = ariaSingleHoldsAtMostOne(controlled, multi, popcount(selected))
  // the type-ahead buffer fills left to right
  val TypeaheadBufferShape: bool = or(ta1 != "", ta2 == "")
  // activation only ever reports a real node
  val ActivatedKnown: bool = and(activated >= 0, activated <= 7)
  // callbacks only ever count up from zero
  val RequestsNonNegative: bool = requests >= 0
  // controlled: only the value prop sets the selection, so no event commits
  val ControlledFollowsProp: bool = or(not(controlled), selected == propMask)
  // a rejected request leaves the selection as it found it
  val RejectedRequestUntouched: bool = or(not(outcome == "rejected"), selected == base)
  // an accepted request committed exactly its intent
  val AcceptedRequestCommits: bool = or(not(outcome == "accepted"), selected == requested)
}
