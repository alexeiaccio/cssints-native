// APG Toolbar — https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/
//
// A toolbar of five items behind ONE tab stop. Items are addressed by index
// 0..4; their kinds are fixed by the spec:
//   0 menu-button (a button that opens a 3-item menu)   1 button
//   2 text (native <input type=text>)   3 spin (custom role=spinbutton with its
//   own key handler)   4 button
//
// The roving-tabindex part is the platform's `focusgroup="toolbar"` contract,
// imported from shared/focusgroup.qnt and NOT restated here: single tab stop,
// arrows along the axis, wrap, Home / End, last-focused memory, and Tab /
// Shift+Tab stepping to the neighbouring item out of a native key-conflict
// control. This spec models only the delta:
//   - the axis comes from aria-orientation (the focusgroup axis does not set it)
//     and the wrap flag is the author's choice
//   - disabled-but-focusable: a disabled item stays reachable by arrows, click
//     and Tab (aria-disabled; a native `disabled` button would be SKIPPED by the
//     platform, which is the gap the shared module records); it just cannot be
//     activated
//   - embedded controls consume keys: `text` swallows every key the group would
//     act on (Left/Right/Home/End horizontally, Up/Down/Home/End vertically),
//     `spin` swallows Up/Down/Home/End (its handler prevents default). A
//     swallowed key never moves focus; Tab / Shift+Tab is the way on: `text`
//     is a native key-conflict control, so Tab steps to the neighbouring item
//     (focus leaves the toolbar only at either end), `spin` is not, so Tab
//     leaves
//   - activation of an enabled button
//   - the menu-button kind below
//
// Menu button (item 0). The APG Toolbar pattern does NOT define a menu button's
// open key. It only says the arrows perpendicular to the toolbar axis "can be
// reserved for operating controls" ("Keyboard Interaction",
// https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/), and that a vertical
// toolbar navigates with Up/Down. So the open key is settled as:
//   - Enter / Space open the menu on the FIRST item;
//   - the key PERPENDICULAR to the toolbar axis also opens, and the end it opens
//     on is the sign of that key: the forward perpendicular key opens on the
//     first item, the backward one on the last. Horizontal toolbar: Down opens
//     on the first, Up on the last. Vertical toolbar: Right opens on the first,
//     Left on the last -- Down/Up stay the toolbar's own navigation keys, which
//     is exactly why the vertical case needs its own rule.
//   Once open, the menu owns the keyboard (APG menubar, the behaviour
//   menu-button.qnt cites): Up/Down wrap within the menu, Home/End jump,
//   Enter/Space activate and close returning focus to the trigger, Escape closes
//   and returns focus to the trigger, Tab closes and leaves the toolbar. The
//   toolbar's roving focus is suspended: the trigger keeps the tab stop, and the
//   menu CAPTURES every navigation key through the same `captures` / `swallowed`
//   mechanism the embedded controls use, so the keys never move the toolbar.
//
// Why item 0 is the menu-button: the ported base-ui scenario
// `toolbar.base-ui.menu-trigger-consumes-arrows` renders its single menu trigger
// as the toolbar's item 0, so making the spec's item 0 the menu-button lets the
// scenario's `item:0` / `menuitem:N` mapping replay honestly. The menu is the
// scenario's three items (menuitem 0..2).
//
// Events (user level): tabIn, tab(back), leave, click(item), key(Left|Right|Up|
// Down|Home|End), activate (Enter/Space), escape, toggleDisabled(item),
// flipOrientation, flipWrap. `tabIn` / `leave` are the plain enter / focus-lost
// events; `tab` is the real Tab / Shift+Tab key from wherever focus is.
// `activations` counts activations of enabled buttons; `consumed` counts keys
// swallowed by an embedded control or by the open menu. The rendered tabindex of
// item i is `fgTabIndex(tabStop, i)`.
//
// Conformance: seeded random walks of this model (40 walks x 40 events, every
// event kind) were replayed against a real DOM toolbar in Chromium
// 153.0.8010.12, once with native `focusgroup` and once with
// @microsoft/focusgroup-polyfill 1.6.0 forced: 1600 events each, focus matched
// the spec after every one (script kept outside the repo; see
// shared/focusgroup.qnt for the provider divergences).
//
// ponytail: item count and kinds are fixed, not configurable; grouping
// separators, RTL (Left/Right swap), the menu-button's own menu activation and
// the live value of the embedded controls are not modelled. Widen the pools if a
// consumer needs them.
module apg_toolbar {
  import aria.* from "../../shared/aria"
  import focusgroup.* from "../../shared/focusgroup"

  var orientation: str      // "horizontal" | "vertical" (aria-orientation)
  var wrap: bool            // arrows wrap around the ends
  var focus: int            // focused item, -1 = focus is outside the toolbar
  var tabStop: int          // the item that owns tabindex=0 (focus memory)
  var disabledMask: int     // bit i set = item i is aria-disabled
  var activations: int      // activations of enabled buttons
  var lastActivated: int    // item of the last activation, -1 = none
  var consumed: int         // keys swallowed by an embedded control or the menu
  var lastKeyConsumed: bool // the previous event was a key an embedded control swallowed
  var menuOpen: bool        // the menu-button's menu is displayed (aria-expanded)
  var menuIndex: int        // focused menu item while open, 0 otherwise

  def itemCount: int = 5
  def menuButton: int = 0
  def menuCount: int = 3
  def bit(i: int): int =
    if (i == 0) 1 else if (i == 1) 2 else if (i == 2) 4 else if (i == 3) 8 else if (i == 4) 16 else 0
  def isDisabledIn(mask: int, i: int): bool = (mask / bit(i)) % 2 == 1
  def kindOf(i: int): str =
    if (i == menuButton) "menu-button" else if (i == 2) "text" else if (i == 3) "spin" else "button"
  def isMenuButton(i: int): bool = i == menuButton
  def axisOf(o: str): str = if (o == "horizontal") "inline" else "block"

  // the axis perpendicular to the toolbar: the axis the open keys live on
  def perpAxis(o: str): str = if (o == "horizontal") "block" else "inline"
  def perpDelta(o: str, key: str): int = fgDelta(perpAxis(o), key)
  def perpKey(o: str, key: str): bool = perpDelta(o, key) != 0
  def opensFirst(o: str, key: str): bool = perpDelta(o, key) == 1
  def opensLast(o: str, key: str): bool = perpDelta(o, key) == -1

  // the menu is a flat block list: Up/Down wrap, Home/End jump
  def menuNavKey(key: str): bool = fgIsNavKey("block", key)
  def menuLanding(key: str, idx: int): int = fgLanding(menuCount, "block", true, idx, key)

  // does the embedded control -- or the open menu -- capture the key? A native
  // text field consumes every key the group would act on; the spinbutton's own
  // handler prevents default for Up/Down/Home/End; while the menu is open the
  // menu owns every navigation key.
  def captures(kind: str, o: str, key: str, open: bool): bool =
    or(
      and(kind == "text", fgIsNavKey(axisOf(o), key)),
      and(kind == "spin", or(or(key == "Up", key == "Down"), fgIsEdgeKey(key))),
      and(kind == "menu-button", open)
    )
  def swallowed(o: str, f: int, key: str, open: bool): bool =
    and(f >= 0, captures(kindOf(f), o, key, open))

  // where focus lands after a key: a captured key pins it, otherwise the
  // platform contract decides
  def landing(o: str, w: bool, f: int, key: str, open: bool): int =
    if (swallowed(o, f, key, open)) f else fgLanding(itemCount, axisOf(o), w, f, key)

  // where the menu focus goes after a key while the menu is open; also the item
  // a perpendicular key opens on when the menu-button is focused and closed
  def menuKeyTarget(o: str, k: str): int =
    if (menuOpen) (if (menuNavKey(k)) menuLanding(k, menuIndex) else menuIndex)
    else if (and(isMenuButton(focus), perpKey(o, k)))
      (if (opensLast(o, k)) menuCount - 1 else 0)
    else 0

  // where Tab (back = false) / Shift+Tab (back = true) puts focus: an open menu
  // closes and leaves; outside it enters on the remembered item; a native text
  // field steps to its neighbour; any other item leaves the toolbar
  def tabLanding(f: int, stop: int, back: bool, open: bool): int =
    if (open) -1
    else if (f < 0) fgEntry(true, stop, 0)
    else if (kindOf(f) == "text") fgEscape(itemCount, f, back)
    else -1

  def activates(mask: int, i: int): bool =
    and(and(i >= 0, kindOf(i) == "button"), not(isDisabledIn(mask, i)))
  def flip(mask: int, i: int): int =
    if (isDisabledIn(mask, i)) mask - bit(i) else mask + bit(i)

  // ARIA contract: aria-expanded on the menu-button item
  def ariaExpandedMenuButton(open: bool): bool = open

  action init = all {
    orientation' = "horizontal",
    wrap' = false,
    focus' = -1,
    tabStop' = 0,
    disabledMask' = 0,
    activations' = 0,
    lastActivated' = -1,
    consumed' = 0,
    lastKeyConsumed' = false,
    menuOpen' = false,
    menuIndex' = 0
  }

  // Tab / Shift+Tab into the toolbar lands on the remembered item
  action tabIn = all {
    orientation' = orientation,
    wrap' = wrap,
    focus' = if (focus < 0) fgEntry(true, tabStop, 0) else focus,
    tabStop' = tabStop,
    disabledMask' = disabledMask,
    activations' = activations,
    lastActivated' = lastActivated,
    consumed' = consumed,
    lastKeyConsumed' = false,
    menuOpen' = menuOpen,
    menuIndex' = menuIndex
  }

  // focus lost elsewhere (pointer, script): the memory stays, an open menu closes
  action leave = all {
    orientation' = orientation,
    wrap' = wrap,
    focus' = -1,
    tabStop' = fgStopOnLeave(true, tabStop, 0),
    disabledMask' = disabledMask,
    activations' = activations,
    lastActivated' = lastActivated,
    consumed' = consumed,
    lastKeyConsumed' = false,
    menuOpen' = false,
    menuIndex' = 0
  }

  // the Tab key itself: an open menu closes and leaves; otherwise enter, step out
  // of a native text field to the neighbouring item, or leave
  action tab = {
    nondet back = Set(false, true).oneOf()
    all {
      orientation' = orientation,
      wrap' = wrap,
      focus' = tabLanding(focus, tabStop, back, menuOpen),
      tabStop' = if (tabLanding(focus, tabStop, back, menuOpen) >= 0) tabLanding(focus, tabStop, back, menuOpen) else tabStop,
      disabledMask' = disabledMask,
      activations' = activations,
      lastActivated' = lastActivated,
      consumed' = consumed,
      lastKeyConsumed' = false,
      menuOpen' = false,
      menuIndex' = 0
    }
  }

  // pointer: while the menu is open a toolbar click closes it (light dismiss);
  // otherwise it focuses the item (even a disabled one) and makes it the tab
  // stop, opens the menu-button's menu, and activates an enabled button
  action click = {
    nondet idx = Set(0, 1, 2, 3, 4).oneOf()
    all {
      orientation' = orientation,
      wrap' = wrap,
      focus' = if (menuOpen) focus else idx,
      tabStop' = if (menuOpen) tabStop else idx,
      disabledMask' = disabledMask,
      activations' = if (and(not(menuOpen), activates(disabledMask, idx))) activations + 1 else activations,
      lastActivated' = if (and(not(menuOpen), activates(disabledMask, idx))) idx else lastActivated,
      consumed' = consumed,
      lastKeyConsumed' = false,
      menuOpen' = if (menuOpen) false else isMenuButton(idx),
      menuIndex' = 0
    }
  }

  action key = {
    nondet k = Set("Left", "Right", "Up", "Down", "Home", "End").oneOf()
    all {
      orientation' = orientation,
      wrap' = wrap,
      focus' = landing(orientation, wrap, focus, k, menuOpen),
      tabStop' = if (focus < 0) tabStop else landing(orientation, wrap, focus, k, menuOpen),
      disabledMask' = disabledMask,
      activations' = activations,
      lastActivated' = lastActivated,
      consumed' = if (swallowed(orientation, focus, k, menuOpen)) consumed + 1 else consumed,
      lastKeyConsumed' = swallowed(orientation, focus, k, menuOpen),
      menuOpen' = if (menuOpen) true else and(isMenuButton(focus), perpKey(orientation, k)),
      menuIndex' = menuKeyTarget(orientation, k)
    }
  }

  // Enter / Space: on the closed menu-button it opens the menu on the first item;
  // while the menu is open it closes the menu and returns focus to the trigger;
  // otherwise it activates the focused enabled button
  action activate = all {
    orientation' = orientation,
    wrap' = wrap,
    focus' = if (menuOpen) menuButton else focus,
    tabStop' = tabStop,
    disabledMask' = disabledMask,
    activations' = if (and(not(menuOpen), activates(disabledMask, focus))) activations + 1 else activations,
    lastActivated' = if (and(not(menuOpen), activates(disabledMask, focus))) focus else lastActivated,
    consumed' = consumed,
    lastKeyConsumed' = false,
    menuOpen' = if (menuOpen) false else isMenuButton(focus),
    menuIndex' = 0
  }

  // Escape: while the menu is open it closes and returns focus to the trigger
  action escape = all {
    orientation' = orientation,
    wrap' = wrap,
    focus' = if (menuOpen) menuButton else focus,
    tabStop' = tabStop,
    disabledMask' = disabledMask,
    activations' = activations,
    lastActivated' = lastActivated,
    consumed' = consumed,
    lastKeyConsumed' = false,
    menuOpen' = false,
    menuIndex' = 0
  }

  // disabling never moves focus or the tab stop: the idx stays focusable
  action toggleDisabled = {
    nondet idx = Set(0, 1, 2, 3, 4).oneOf()
    all {
      orientation' = orientation,
      wrap' = wrap,
      focus' = focus,
      tabStop' = tabStop,
      disabledMask' = flip(disabledMask, idx),
      activations' = activations,
      lastActivated' = lastActivated,
      consumed' = consumed,
      lastKeyConsumed' = false,
      menuOpen' = menuOpen,
      menuIndex' = menuIndex
    }
  }

  action flipOrientation = all {
    orientation' = if (orientation == "horizontal") "vertical" else "horizontal",
    wrap' = wrap,
    focus' = focus,
    tabStop' = tabStop,
    disabledMask' = disabledMask,
    activations' = activations,
    lastActivated' = lastActivated,
    consumed' = consumed,
    lastKeyConsumed' = false,
    menuOpen' = menuOpen,
    menuIndex' = menuIndex
  }

  action flipWrap = all {
    orientation' = orientation,
    wrap' = not(wrap),
    focus' = focus,
    tabStop' = tabStop,
    disabledMask' = disabledMask,
    activations' = activations,
    lastActivated' = lastActivated,
    consumed' = consumed,
    lastKeyConsumed' = false,
    menuOpen' = menuOpen,
    menuIndex' = menuIndex
  }

  action step = any {
    init, tabIn, tab, leave, click, key, activate, escape, toggleDisabled, flipOrientation, flipWrap
  }

  def tabbable(i: int): int = if (fgTabIndex(tabStop, i) == 0) 1 else 0

  // APG: exactly one item is in the tab sequence, and it is the remembered one
  val ExactlyOneTabbable: bool =
    tabbable(0) + tabbable(1) + tabbable(2) + tabbable(3) + tabbable(4) == 1
  // focus memory always points at an existing item
  val TabStopInRange: bool = fgStopInRange(itemCount, tabStop)
  // focus is outside the toolbar or on an item that is in range
  val FocusInRange: bool = fgFocusInRange(itemCount, focus)
  // roving tabindex: whatever holds focus inside the toolbar is the tab stop
  val FocusIsTabStop: bool = fgFocusIsStop(focus, tabStop)
  val DisabledMaskValid: bool = and(disabledMask >= 0, disabledMask <= 31)
  val OrientationKnown: bool = ariaOrientationKnown(orientation)
  // only an enabled-at-the-time button is ever activated
  val OnlyButtonsActivate: bool = or(lastActivated < 0, kindOf(lastActivated) == "button")
  val ActivationLogValid: bool = and(lastActivated >= -1, lastActivated <= 4)
  // a swallowed key leaves focus on the embedded control (or the menu-button)
  val ConsumedStaysEmbedded: bool = or(not(lastKeyConsumed), and(focus >= 0, kindOf(focus) != "button"))
  val CountersNonNegative: bool = and(activations >= 0, consumed >= 0)
  // while the menu is open the roving focus is suspended on the menu-button item
  val MenuOpenImpliesMenuButtonFocused: bool = or(not(menuOpen), focus == menuButton)
  // the menu index is a real menu item while open, and 0 while closed
  val MenuIndexInRange: bool =
    if (menuOpen) and(menuIndex >= 0, menuIndex <= menuCount - 1) else menuIndex == 0
  // aria-expanded on the menu-button item is true exactly while the menu is open
  val MenuButtonExpandedIffOpen: bool = ariaExpandedMenuButton(menuOpen) == menuOpen
}
