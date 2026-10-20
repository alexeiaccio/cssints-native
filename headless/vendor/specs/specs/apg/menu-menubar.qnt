// WAI-ARIA APG — Menu and Menubar: roving focus, nested submenus, typeahead.
//
// Pattern:  https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
//   - "Keyboard Interaction": Tab / Shift+Tab, Enter, Space, Down/Up/Right/Left
//     Arrow, Home/End, printable-character typeahead, Escape, and the rule that
//     Right/Left Arrow on a menubar item with a submenu open it "without moving
//     focus into the submenu" (the Recommended variant, modelled here).
//   - "WAI-ARIA Roles, States, and Properties": aria-haspopup / aria-expanded on
//     parent menuitems, roving tabindex (one menubar item has tabindex=0).
// Examples: https://www.w3.org/WAI/ARIA/apg/patterns/menubar/examples/menubar-editor/
//           https://www.w3.org/WAI/ARIA/apg/patterns/menubar/examples/menubar-navigation/
//
// Request vs commit (map ticket rt1p). The controlled value is the open *top*
// menu (`openTop`, 0 = none): a menubar whose open menu a host owns. Every event
// that would open or close/replace that menu — tab_out, arrow_right/left/down/up,
// key_home/end, activate, escape, typeahead when it moves along the bar — is a
// *request* carrying the intended `openTop` (`requested`); it fires the change
// callback (`requests` counts the calls) when the intent differs, and then:
//   uncontrolled        the request is accepted: the whole transition commits
//   controlled, holds   the host ignores it ("rejected"): nothing moves
//   controlled, accepts the host answers with the same value (`accepting`): the
//                       transition commits through the controlled value
// `valueProp` is the only thing that changes `openTop` while `controlled`;
// `setValue` / `hostToggle` are the host writing it. `control` / `acceptRequests`
// are configuration events (init is literal-only). A rejected request reverts the
// *whole* transition (focus and roving tab stop included), so the ARIA
// invariants still hold. `openSub` (which item's submenu is open) stays inside
// the open menu and is not part of the controlled value.
//
// Fixed fixture (the menu tree is data of the model, indices are 1-based, 0 = none):
//
//   menubar:   1 "File" ▸      2 "Edit" ▸      3 "About" (plain link, no menu)
//   menu(1):   1 plain         2 plain ▸ (submenu, 2 items)         3 plain
//   menu(2):   1 plain         2 plain
//   submenu(1,2): 1 plain      2 plain                 (depth bound: menubar + 2 levels)
//
// Focus is `(focusLevel, focusIdx)`: level 0 = outside the widget, 1 = menubar,
// 2 = a top-level menu, 3 = the submenu of the open item. The open path is
// `(openTop, openSub)`: at most one open menu per level is structural (each is one
// slot), `openSub` is the index inside menu(openTop) whose submenu is open.
//
// ARIA contract (derived defs, consumed by the invariants and by an implementation):
//   tabIndexBar(i, barStop)        roving tabindex: 0 on barStop, -1 elsewhere
//   ariaHasPopupBar / ariaHasPopupItem   parent menuitems (aria-haspopup)
//   ariaExpandedBar(i, openTop)    aria-expanded on a menubar item
//   ariaExpandedItem(t, i, openTop, openSub)  aria-expanded on a menu item
//
// Deliberate omissions (generator subset / scope): Shift+Tab is the same event as
// Tab (`tab_out`); no pointer/hover events; no disabled items and no
// menuitemcheckbox/menuitemradio (see menu-checkable.qnt); no aria-activedescendant
// variant (focus is modelled as `element.focus()`); no vertical orientation; no
// separators; Home/End are always available alongside wrapping; Enter vs Space is
// one `activate` event with a `key` pool because they only differ on checkable
// items; typeahead matches a one-letter label code (1..3) rather than a string,
// starting after the focused item and wrapping; activating a leaf closes every menu
// and returns focus to the menubar item that owns the menu (APG note 3 allows the
// invoking context instead); activations are recorded as an opaque `lastActivated`
// code (top*100 + item*10 + subitem).
module apg_menu_menubar {
  import aria.* from "../../shared/aria"

  var focusLevel: int    // 0 outside | 1 menubar | 2 top-level menu | 3 submenu
  var focusIdx: int      // focused item inside its container (0 when outside)
  var barStop: int       // roving-tabindex holder of the menubar (1..3)
  var openTop: int       // menubar item whose menu is open (0 none)
  var openSub: int       // item of menu(openTop) whose submenu is open (0 none)
  var lastActivated: int // code of the last activated leaf (0 none)
  var controlled: bool   // the host owns `openTop` (`value` prop present)
  var accepting: bool    // controlled host that answers every request with its intent
  var valueProp: int     // the controlled open top menu (meaningful while controlled)
  var requested: int     // intent of the last request
  var outcome: str       // "none" | "accepted" | "rejected"
  var base: int          // openTop when the last request was received
  var requests: int      // number of requests that fired the change callback

  // ---- fixture ----------------------------------------------------------
  def menuSize(t: int): int = if (t == 1) 3 else if (t == 2) 2 else 0
  def subSize(t: int, i: int): int = if (and(t == 1, i == 2)) 2 else 0
  def hasMenu(t: int): bool = menuSize(t) > 0
  def hasSub(t: int, i: int): bool = subSize(t, i) > 0
  def containerSize(l: int, t: int, s: int): int =
    if (l == 1) 3 else if (l == 2) menuSize(t) else if (l == 3) subSize(t, s) else 0
  // one-letter label codes (typeahead): bar 1,2,3 | menu(1) 1,2,1 | menu(2) 2,3 | sub 3,1
  def letterOf(l: int, t: int, i: int): int =
    if (l == 1) i
    else if (l == 2) (if (t == 1) (if (i == 2) 2 else 1) else (if (i == 1) 2 else 3))
    else (if (i == 1) 3 else 1)

  // ---- movement helpers ---------------------------------------------------
  def barNext(i: int): int = ariaWrapNext1(i, 3)
  def barPrev(i: int): int = ariaWrapPrev1(i, 3)
  // after moving along the menubar, the new item's menu is opened (focus stays on
  // the bar item) only when a menu was already open and the new item has one
  def follow(wasOpen: int, nb: int): int = if (and(wasOpen > 0, hasMenu(nb))) nb else 0
  def cn(l: int, t: int, s: int, i: int): int = ariaWrapNext1(i, containerSize(l, t, s))
  def typeTarget(l: int, t: int, s: int, i: int, ch: int): int =
    if (letterOf(l, t, cn(l, t, s, i)) == ch) cn(l, t, s, i)
    else if (letterOf(l, t, cn(l, t, s, cn(l, t, s, i))) == ch) cn(l, t, s, cn(l, t, s, i))
    else if (letterOf(l, t, cn(l, t, s, cn(l, t, s, cn(l, t, s, i)))) == ch) cn(l, t, s, cn(l, t, s, cn(l, t, s, i)))
    else i

  // ---- activation decisions -----------------------------------------------
  def entersSub(l: int, t: int, i: int): bool = and(l == 2, hasSub(t, i))
  def opensMenu(l: int, b: int): bool = and(l == 1, hasMenu(b))
  def fires(l: int, b: int, t: int, i: int): bool =
    and(l > 0, not(opensMenu(l, b)), not(entersSub(l, t, i)))
  def activationCode(l: int, b: int, t: int, s: int, i: int): int =
    if (l == 1) b * 100 else if (l == 2) t * 100 + i * 10 else t * 100 + s * 10 + i

  // ---- ARIA contract (derived) -------------------------------------------
  def b2i(b: bool): int = if (b) 1 else 0
  def tabIndexBar(i: int, b: int): int = if (i == b) 0 else -1
  def ariaHasPopupBar(i: int): bool = hasMenu(i)
  def ariaHasPopupItem(t: int, i: int): bool = hasSub(t, i)
  def ariaExpandedBar(i: int, t: int): bool = and(hasMenu(i), t == i)
  def ariaExpandedItem(t: int, i: int, ot: int, s: int): bool =
    and(t > 0, t == ot, hasSub(t, i), s == i)

  // ---- request / commit (map ticket rt1p) ---------------------------------
  def holds: bool = and(controlled, not(accepting))
  def follows: bool = and(controlled, accepting)
  def verdict: str = if (holds) "rejected" else "accepted"
  def landed(h: bool, cur: int, want: int): int = if (h) cur else want
  def propAfter(f: bool, p: int, want: int): int = if (f) want else p
  // the intended open top menu of each request
  def rightWant: int =
    if (entersSub(focusLevel, openTop, focusIdx)) openTop
    else follow(openTop, barNext(barStop))
  def leftWant: int =
    if (or(focusLevel == 0, focusLevel == 3)) openTop
    else follow(openTop, barPrev(barStop))
  def downWant: int = if (opensMenu(focusLevel, barStop)) barStop else openTop
  def homeWant: int = if (focusLevel == 1) follow(openTop, 1) else openTop
  def endWant: int = if (focusLevel == 1) follow(openTop, 3) else openTop
  def activateWant: int =
    if (opensMenu(focusLevel, barStop)) barStop
    else if (and(focusLevel >= 2, not(entersSub(focusLevel, openTop, focusIdx)))) 0
    else openTop
  def escapeWant: int = if (focusLevel == 3) openTop else 0
  def typeWant(ch: int): int =
    if (focusLevel == 1) follow(openTop, typeTarget(focusLevel, openTop, openSub, focusIdx, ch))
    else openTop
  def moves(want: int): bool = want != openTop
  def rejects(want: int): bool = and(holds, moves(want))

  action init = all {
    focusLevel' = 0,
    focusIdx' = 0,
    barStop' = 1,
    openTop' = 0,
    openSub' = 0,
    lastActivated' = 0,
    controlled' = false,
    accepting' = false,
    valueProp' = 0,
    requested' = 0,
    outcome' = "none",
    base' = 0,
    requests' = 0
  }

  // Tab into the menubar: focus lands on the remembered (roving) item
  action focus_in = all {
    focusLevel' = if (focusLevel == 0) 1 else focusLevel,
    focusIdx' = if (focusLevel == 0) barStop else focusIdx,
    barStop' = barStop,
    openTop' = openTop,
    openSub' = openSub,
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = valueProp,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  // request: Tab / Shift+Tab from any item closes every menu and leaves
  action tab_out = all {
    focusLevel' = if (rejects(0)) focusLevel else 0,
    focusIdx' = if (rejects(0)) focusIdx else 0,
    barStop' = barStop,
    openTop' = landed(holds, openTop, 0),
    openSub' = if (rejects(0)) openSub else 0,
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = propAfter(follows, valueProp, 0),
    requested' = if (moves(0)) 0 else requested,
    outcome' = if (moves(0)) verdict else outcome,
    base' = if (moves(0)) openTop else base,
    requests' = if (moves(0)) requests + 1 else requests
  }

  // request: menubar -> next item (its menu follows); menu -> submenu; else no move
  action arrow_right = all {
    focusLevel' = if (rejects(rightWant)) focusLevel
      else if (focusLevel == 0) 0
      else if (entersSub(focusLevel, openTop, focusIdx)) 3
      else 1,
    focusIdx' = if (rejects(rightWant)) focusIdx
      else if (focusLevel == 0) focusIdx
      else if (entersSub(focusLevel, openTop, focusIdx)) 1
      else barNext(barStop),
    barStop' = if (rejects(rightWant)) barStop
      else if (or(focusLevel == 0, entersSub(focusLevel, openTop, focusIdx))) barStop
      else barNext(barStop),
    openTop' = landed(holds, openTop, rightWant),
    openSub' = if (rejects(rightWant)) openSub
      else if (entersSub(focusLevel, openTop, focusIdx)) focusIdx
      else 0,
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = propAfter(follows, valueProp, rightWant),
    requested' = if (moves(rightWant)) rightWant else requested,
    outcome' = if (moves(rightWant)) verdict else outcome,
    base' = if (moves(rightWant)) openTop else base,
    requests' = if (moves(rightWant)) requests + 1 else requests
  }

  // request: submenu -> parent item; top-level menu -> previous menubar item
  action arrow_left = all {
    focusLevel' = if (rejects(leftWant)) focusLevel
      else if (focusLevel == 0) 0
      else if (focusLevel == 3) 2
      else 1,
    focusIdx' = if (rejects(leftWant)) focusIdx
      else if (focusLevel == 0) focusIdx
      else if (focusLevel == 3) openSub
      else barPrev(barStop),
    barStop' = if (rejects(leftWant)) barStop
      else if (or(focusLevel == 0, focusLevel == 3)) barStop
      else barPrev(barStop),
    openTop' = landed(holds, openTop, leftWant),
    openSub' = if (rejects(leftWant)) openSub else 0,
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = propAfter(follows, valueProp, leftWant),
    requested' = if (moves(leftWant)) leftWant else requested,
    outcome' = if (moves(leftWant)) verdict else outcome,
    base' = if (moves(leftWant)) openTop else base,
    requests' = if (moves(leftWant)) requests + 1 else requests
  }

  // request: menubar -> open the menu on its first item; menu -> next item, wrapping
  action arrow_down = all {
    focusLevel' = if (rejects(downWant)) focusLevel
      else if (opensMenu(focusLevel, barStop)) 2
      else focusLevel,
    focusIdx' = if (rejects(downWant)) focusIdx
      else if (opensMenu(focusLevel, barStop)) 1
      else if (focusLevel >= 2) ariaWrapNext1(focusIdx, containerSize(focusLevel, openTop, openSub))
      else focusIdx,
    barStop' = barStop,
    openTop' = landed(holds, openTop, downWant),
    openSub' = if (rejects(downWant)) openSub else openSub,
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = propAfter(follows, valueProp, downWant),
    requested' = if (moves(downWant)) downWant else requested,
    outcome' = if (moves(downWant)) verdict else outcome,
    base' = if (moves(downWant)) openTop else base,
    requests' = if (moves(downWant)) requests + 1 else requests
  }

  // request: menubar (optional APG behaviour) -> open the menu on its last item
  action arrow_up = all {
    focusLevel' = if (rejects(downWant)) focusLevel
      else if (opensMenu(focusLevel, barStop)) 2
      else focusLevel,
    focusIdx' = if (rejects(downWant)) focusIdx
      else if (opensMenu(focusLevel, barStop)) menuSize(barStop)
      else if (focusLevel >= 2) ariaWrapPrev1(focusIdx, containerSize(focusLevel, openTop, openSub))
      else focusIdx,
    barStop' = barStop,
    openTop' = landed(holds, openTop, downWant),
    openSub' = if (rejects(downWant)) openSub else openSub,
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = propAfter(follows, valueProp, downWant),
    requested' = if (moves(downWant)) downWant else requested,
    outcome' = if (moves(downWant)) verdict else outcome,
    base' = if (moves(downWant)) openTop else base,
    requests' = if (moves(downWant)) requests + 1 else requests
  }

  // request: Home on the menubar; a menu re-opens when one was open
  action key_home = all {
    focusLevel' = focusLevel,
    focusIdx' = if (rejects(homeWant)) focusIdx else if (focusLevel == 0) focusIdx else 1,
    barStop' = if (rejects(homeWant)) barStop else if (focusLevel == 1) 1 else barStop,
    openTop' = landed(holds, openTop, homeWant),
    openSub' = openSub,
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = propAfter(follows, valueProp, homeWant),
    requested' = if (moves(homeWant)) homeWant else requested,
    outcome' = if (moves(homeWant)) verdict else outcome,
    base' = if (moves(homeWant)) openTop else base,
    requests' = if (moves(homeWant)) requests + 1 else requests
  }

  // request: End on the menubar; a menu re-opens when one was open
  action key_end = all {
    focusLevel' = focusLevel,
    focusIdx' = if (rejects(endWant)) focusIdx else if (focusLevel == 0) focusIdx else containerSize(focusLevel, openTop, openSub),
    barStop' = if (rejects(endWant)) barStop else if (focusLevel == 1) 3 else barStop,
    openTop' = landed(holds, openTop, endWant),
    openSub' = openSub,
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = propAfter(follows, valueProp, endWant),
    requested' = if (moves(endWant)) endWant else requested,
    outcome' = if (moves(endWant)) verdict else outcome,
    base' = if (moves(endWant)) openTop else base,
    requests' = if (moves(endWant)) requests + 1 else requests
  }

  // request: Enter / Space: a parent item opens its submenu on the first item; any
  // other item is activated, every menu closes and focus returns to the menubar item
  action activate = {
    nondet key = Set("Enter", "Space").oneOf()
    all {
      focusLevel' = if (rejects(activateWant)) focusLevel
        else if (opensMenu(focusLevel, barStop)) 2
        else if (entersSub(focusLevel, openTop, focusIdx)) 3
        else if (focusLevel == 0) 0
        else 1,
      focusIdx' = if (rejects(activateWant)) focusIdx
        else if (or(opensMenu(focusLevel, barStop), entersSub(focusLevel, openTop, focusIdx))) 1
        else if (focusLevel >= 2) openTop
        else focusIdx,
      barStop' = barStop,
      openTop' = landed(holds, openTop, activateWant),
      openSub' = if (rejects(activateWant)) openSub
        else if (entersSub(focusLevel, openTop, focusIdx)) focusIdx
        else 0,
      lastActivated' = if (rejects(activateWant)) lastActivated
        else if (fires(focusLevel, barStop, openTop, focusIdx))
          activationCode(focusLevel, barStop, openTop, openSub, focusIdx)
        else lastActivated,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = propAfter(follows, valueProp, activateWant),
      requested' = if (moves(activateWant)) activateWant else requested,
      outcome' = if (moves(activateWant)) verdict else outcome,
      base' = if (moves(activateWant)) openTop else base,
      requests' = if (moves(activateWant)) requests + 1 else requests
    }
  }

  // request: Escape: close the menu holding focus and return focus to its invoker
  // (parent item for a submenu, menubar item for a top-level menu); on the
  // menubar it dismisses a menu that is open without focus
  action escape = all {
    focusLevel' = if (rejects(escapeWant)) focusLevel
      else if (focusLevel == 3) 2
      else if (focusLevel == 2) 1
      else focusLevel,
    focusIdx' = if (rejects(escapeWant)) focusIdx
      else if (focusLevel == 3) openSub
      else if (focusLevel == 2) openTop
      else focusIdx,
    barStop' = barStop,
    openTop' = landed(holds, openTop, escapeWant),
    openSub' = if (rejects(escapeWant)) openSub else 0,
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = propAfter(follows, valueProp, escapeWant),
    requested' = if (moves(escapeWant)) escapeWant else requested,
    outcome' = if (moves(escapeWant)) verdict else outcome,
    base' = if (moves(escapeWant)) openTop else base,
    requests' = if (moves(escapeWant)) requests + 1 else requests
  }

  // request (on the menubar): printable character moves the roving focus (and a
  // followed menu); inside a menu it only moves focus within the container
  action typeahead = {
    nondet ch = Set(1, 2, 3).oneOf()
    all {
      focusLevel' = focusLevel,
      focusIdx' = if (focusLevel == 0)
        focusIdx
        else if (rejects(typeWant(ch))) focusIdx
        else typeTarget(focusLevel, openTop, openSub, focusIdx, ch),
      barStop' = if (rejects(typeWant(ch))) barStop
        else if (focusLevel == 1) typeTarget(focusLevel, openTop, openSub, focusIdx, ch)
        else barStop,
      openTop' = landed(holds, openTop, typeWant(ch)),
      openSub' = openSub,
      lastActivated' = lastActivated,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = propAfter(follows, valueProp, typeWant(ch)),
      requested' = if (moves(typeWant(ch))) typeWant(ch) else requested,
      outcome' = if (moves(typeWant(ch))) verdict else outcome,
      base' = if (moves(typeWant(ch))) openTop else base,
      requests' = if (moves(typeWant(ch))) requests + 1 else requests
    }
  }

  // commit: the host writes the controlled open top menu (a no-op while uncontrolled)
  action setValue = {
    nondet t = Set(0, 1, 2).oneOf()
    all {
      focusLevel' = if (controlled) 1 else focusLevel,
      focusIdx' = if (controlled) (if (t == 0) barStop else t) else focusIdx,
      barStop' = if (controlled) (if (t == 0) barStop else t) else barStop,
      openTop' = if (controlled) t else openTop,
      openSub' = if (controlled) 0 else openSub,
      lastActivated' = lastActivated,
      controlled' = controlled,
      accepting' = accepting,
      valueProp' = if (controlled) t else valueProp,
      requested' = requested,
      outcome' = if (controlled) "none" else outcome,
      base' = base,
      requests' = requests
    }
  }

  // commit: the host flips its own copy of the open top menu (open the first menu
  // with one, close with none)
  action hostToggle = all {
    focusLevel' = if (controlled) 1 else focusLevel,
    focusIdx' = if (controlled) (if (valueProp == 0) 1 else barStop) else focusIdx,
    barStop' = if (controlled) (if (valueProp == 0) 1 else barStop) else barStop,
    openTop' = if (controlled) (if (valueProp == 0) 1 else 0) else openTop,
    openSub' = if (controlled) 0 else openSub,
    lastActivated' = lastActivated,
    controlled' = controlled,
    accepting' = accepting,
    valueProp' = if (controlled) (if (valueProp == 0) 1 else 0) else valueProp,
    requested' = requested,
    outcome' = if (controlled) "none" else outcome,
    base' = base,
    requests' = requests
  }

  // configuration: the host starts owning the open top menu, adopting the current one
  action control = all {
    focusLevel' = focusLevel,
    focusIdx' = focusIdx,
    barStop' = barStop,
    openTop' = openTop,
    openSub' = openSub,
    lastActivated' = lastActivated,
    controlled' = true,
    accepting' = accepting,
    valueProp' = openTop,
    requested' = requested,
    outcome' = outcome,
    base' = base,
    requests' = requests
  }

  // configuration: the controlled host answers every request with its intent
  action acceptRequests = all {
    focusLevel' = focusLevel,
    focusIdx' = focusIdx,
    barStop' = barStop,
    openTop' = openTop,
    openSub' = openSub,
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
    init, focus_in, tab_out, arrow_right, arrow_left, arrow_down, arrow_up,
    key_home, key_end, activate, escape, typeahead,
    setValue, hostToggle, control, acceptRequests
  }

  val LevelValid: bool = and(focusLevel >= 0, focusLevel <= 3)
  // outside the widget nothing is open and nothing is focused
  val FocusOutsideClosesAll: bool =
    or(focusLevel != 0, and(focusIdx == 0, openTop == 0, openSub == 0))
  // focus on the menubar sits on the roving tab stop
  val BarFocusIsTabStop: bool =
    or(focusLevel != 1, and(focusIdx == barStop, barStop >= 1, barStop <= 3))
  // focus inside a menu is on an item of the open path
  val FocusInsideOpenPath: bool = and(
    or(focusLevel != 2, and(openTop > 0, openTop == barStop, openSub == 0,
      focusIdx >= 1, focusIdx <= menuSize(openTop))),
    or(focusLevel != 3, and(openTop > 0, hasSub(openTop, openSub),
      focusIdx >= 1, focusIdx <= subSize(openTop, openSub)))
  )
  // the open path is well formed: a menu belongs to the roving item, a submenu
  // to a parent item of that menu and only while focus is inside it
  val OpenPathWellFormed: bool = and(
    or(openTop == 0, and(hasMenu(openTop), openTop == barStop)),
    or(openSub == 0, and(openTop > 0, hasSub(openTop, openSub), focusLevel == 3))
  )
  // exactly one menubar item has tabindex=0
  val ExactlyOneBarTabStop: bool =
    b2i(tabIndexBar(1, barStop) == 0) + b2i(tabIndexBar(2, barStop) == 0) + b2i(tabIndexBar(3, barStop) == 0) == 1
  // at most one menubar item is aria-expanded, and it is the one with the open menu
  val AtMostOneBarExpanded: bool =
    and(
      b2i(ariaExpandedBar(1, openTop)) + b2i(ariaExpandedBar(2, openTop)) + b2i(ariaExpandedBar(3, openTop)) <= 1,
      or(openTop == 0, ariaExpandedBar(openTop, openTop))
    )
  // at most one menu item is aria-expanded, and it is the parent of the open submenu
  val AtMostOneItemExpanded: bool =
    and(
      b2i(ariaExpandedItem(openTop, 1, openTop, openSub)) + b2i(ariaExpandedItem(openTop, 2, openTop, openSub)) + b2i(ariaExpandedItem(openTop, 3, openTop, openSub)) <= 1,
      or(openSub == 0, ariaExpandedItem(openTop, openSub, openTop, openSub))
    )
  // callbacks only ever count up from zero
  val RequestsNonNegative: bool = requests >= 0
  // controlled: only the value prop sets the open menu, so no event commits
  val ControlledFollowsProp: bool = or(not(controlled), openTop == valueProp)
  // a rejected request leaves the state as it found it
  val RejectedRequestUntouched: bool = or(not(outcome == "rejected"), openTop == base)
  // an accepted request committed exactly its intent
  val AcceptedRequestCommits: bool = or(not(outcome == "accepted"), openTop == requested)
}
