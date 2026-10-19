// shared/focusgroup.qnt — the platform contract of the `focusgroup` attribute:
// the roving-tabindex behaviour a widget gets for free from the browser (or
// from @microsoft/focusgroup-polyfill) so a pattern spec models only its delta.
//
// Pure defs only: import with `import focusgroup.* from "../../shared/focusgroup"`.
// Every def is prefixed `fg` so it never collides with a pattern's own defs.
// State (focus, tab stop) is passed IN and the next value comes back OUT; the
// pattern owns the vars. A `val` here would be inlined as an invariant into
// every importer, so invariants are predicate defs the importer wraps in a `val`.
//
// Provided (the contract):
//   - ordered items 0..n-1, exactly ONE tab stop (`fgTabIndex`)
//   - arrows along the axis move focus (`fgDelta`, `fgStep`), perpendicular
//     arrows are left to the author; Home / End jump to first / last
//     (`fgLanding`); `wrap` / `nowrap`; Shift/Ctrl/Meta+key are ignored
//   - last-focused memory on sequential re-entry, `nomemory`, `focusgroupstart`
//     (`fgEntry`, `fgStopOnLeave`)
//   - Tab / Shift+Tab inside a native key-conflict control (<input>, per the
//     explainer also <textarea>, <select>, contenteditable) steps to the
//     NEIGHBOURING item instead of leaving the group (`fgEscape`); at either
//     end it leaves
//   - a keydown whose default was prevented by an item handler is not moved
//   - behaviour tokens: default axis / wrap and the inferred owner and item
//     roles (`fgDefaultAxis`, `fgDefaultWrap`, `fgInferredItemRole`)
//
// NOT provided, so still the pattern's own (the gap list):
//   - selection (explicitly decoupled), activation (Enter/Space), typeahead
//   - `aria-activedescendant` focus models (a combobox popup is not a focusgroup)
//   - submenu open/close keys, tree expand/collapse, grids (V2, unreleased),
//     `itemcontrols`, `menuitemcheckbox` / `menuitemradio` (never inferred)
//   - `aria-orientation`: the axis does NOT set it (verified: `toolbar block`
//     still exposes orientation=horizontal)
//
// NOT expressible as pure defs (no collections / vars here), so NOT modelled:
//   - item eligibility: disabled / hidden / `tabindex=-1` / `focusgroup=none`
//     items are skipped by the platform. These defs assume all n items are
//     focusable; a pattern that wants a disabled item to stay reachable uses
//     aria-disabled (a native `disabled` button is skipped, verified).
//   - segments and nested groups (one segment is assumed), insert / remove of
//     items, RTL and vertical writing modes (left-to-right, horizontal-tb)
//   Both need `Set[int]` / `List[int]` collections: see
//   docs/research/quint-generator-ui-extensions.md (item 6) and the follow-ups
//   of effects-of-atmosphere-dx00.
//
// Pins (bump deliberately; the explainer is the only spec text):
//   explainer  open-ui scoped-focusgroup.explainer, lastUpdated 2026-07-28
//   polyfill   @microsoft/focusgroup-polyfill 1.6.0 (MIT)
//   verified   Chromium 153.0.8010.12 (Playwright 1.63.0, 2026-10-07): native
//              `focusgroup` (`'focusGroup' in HTMLElement.prototype` is true) and
//              the polyfill, forced with --disable-blink-features=Focusgroup,
//              replayed the same 40 focus/key traces (toolbar, tablist, listbox,
//              menu, menubar, radiogroup): 38 agree. The 2 that differ are
//              Alt+Arrow / Alt+End, which move focus in the polyfill and are
//              ignored natively. Tab-escape was checked for <input type=text>
//              only (arrows consumed on both axes; <select> consumes the inline
//              arrows; <input type=number> consumes them all). Role inference
//              (CDP accessibility tree, 10 markup cases): 7 agree; the polyfill
//              infers `option` on a <button> and `tab` inside a non-generic or
//              role'd owner, native does not. Native `FocusGroup` / `polyfill()`
//              are inert in Chromium >= 150, so a Solid layer sets the attribute
//              there and drives the polyfill's low-level `FocusGroup` + `update()`
//              only where `focusGroup` is absent (teardown: `update({ definition:
//              {} })` BEFORE `disconnect()`, which alone leaves tabindex rewritten).
//              The toolbar model replays against both providers with no
//              divergence (see specs/apg/toolbar.qnt).
module focusgroup {
  // --- behaviour tokens ----------------------------------------------------
  def fgBehaviorKnown(b: str): bool =
    or(
      or(or(b == "toolbar", b == "tablist"), or(b == "radiogroup", b == "listbox")),
      or(b == "menu", b == "menubar")
    )

  // axis: "inline" | "block" | "both" (no explicit axis token)
  def fgDefaultAxis(b: str): str =
    if (or(b == "listbox", b == "menu")) "block"
    else if (b == "radiogroup") "both"
    else "inline"

  def fgDefaultWrap(b: str): bool = and(b != "toolbar", b != "listbox")

  // --- role inference (generic owners only; explicit roles always win) -----
  // ownerKind: "generic" (div/span) | "native"; itemKind: "generic" | "button" | "native"
  // "" means no role is inferred.
  def fgItemRole(b: str): str =
    if (b == "tablist") "tab"
    else if (b == "radiogroup") "radio"
    else if (b == "listbox") "option"
    else if (or(b == "menu", b == "menubar")) "menuitem"
    else ""
  // ARIA-in-HTML: a <button> may take tab / radio / menuitem but not option
  def fgButtonMayTakeRole(role: str): bool =
    or(or(role == "tab", role == "radio"), role == "menuitem")
  def fgInferredOwnerRole(b: str, ownerKind: str, ownerHasRole: bool): str =
    if (and(ownerKind == "generic", not(ownerHasRole))) b else ""
  def fgInferredItemRole(
    b: str,
    ownerKind: str,
    ownerHasRole: bool,
    itemKind: str,
    itemHasRole: bool
  ): str =
    if (or(fgInferredOwnerRole(b, ownerKind, ownerHasRole) == "", itemHasRole)) ""
    else if (itemKind == "generic") fgItemRole(b)
    else if (and(itemKind == "button", fgButtonMayTakeRole(fgItemRole(b)))) fgItemRole(b)
    else ""

  // --- keys ------------------------------------------------------------------
  def fgInlineDelta(axis: str, key: str): int =
    if (axis == "block") 0 else if (key == "Right") 1 else if (key == "Left") -1 else 0
  def fgBlockDelta(axis: str, key: str): int =
    if (axis == "inline") 0 else if (key == "Down") 1 else if (key == "Up") -1 else 0
  // +1 / -1 for a key along the axis, 0 for a perpendicular or unrelated key
  def fgDelta(axis: str, key: str): int = fgInlineDelta(axis, key) + fgBlockDelta(axis, key)
  def fgIsEdgeKey(key: str): bool = or(key == "Home", key == "End")
  // a key the group would act on; a control that consumes it blocks the group
  def fgIsNavKey(axis: str, key: str): bool = or(fgDelta(axis, key) != 0, fgIsEdgeKey(key))

  def fgStep(n: int, wrap: bool, f: int, d: int): int =
    if (d == 1) (if (f >= n - 1) (if (wrap) 0 else f) else f + 1)
    else if (d == -1) (if (f <= 0) (if (wrap) n - 1 else f) else f - 1)
    else f

  // where focus lands after a key; outside the group (f < 0) nothing happens
  def fgLanding(n: int, axis: str, wrap: bool, f: int, key: str): int =
    if (f < 0) f
    else if (key == "Home") 0
    else if (key == "End") n - 1
    else fgStep(n, wrap, f, fgDelta(axis, key))

  // Tab (back = false) / Shift+Tab (back = true) from a native key-conflict
  // control: the neighbouring item, or -1 when it is the last / first (leave)
  def fgEscape(n: int, f: int, back: bool): int =
    if (back) (if (f <= 0) -1 else f - 1)
    else (if (f >= n - 1) -1 else f + 1)

  // --- tab stop and memory ---------------------------------------------------
  // last = -1 is an empty memory; start is the `focusgroupstart` item (or 0)
  def fgEntry(memory: bool, last: int, start: int): int =
    if (and(memory, last >= 0)) last else start
  // the tab stop once focus has left the group
  def fgStopOnLeave(memory: bool, current: int, start: int): int =
    if (memory) current else start
  // the rendered tabindex of item i given the tab stop
  def fgTabIndex(stop: int, i: int): int = if (stop == i) 0 else -1

  // --- invariant predicates (wrap in a `val` in the pattern) -----------------
  def fgStopInRange(n: int, stop: int): bool = and(stop >= 0, stop <= n - 1)
  def fgFocusInRange(n: int, focus: int): bool = and(focus >= -1, focus <= n - 1)
  // roving tabindex: whatever holds focus inside the group is the tab stop
  def fgFocusIsStop(focus: int, stop: int): bool = or(focus < 0, focus == stop)
}
