// shared/aria.qnt — the ARIA vocabulary the APG pattern specs used to copy: the
// typeahead rules, orientation tokens and key mapping, selection modes and the
// "true" / "false" attribute token, so a pattern spec states only its delta.
//
// Pure defs only: import with `import aria.* from "../../shared/aria"`.
// Every def is prefixed `aria`, and the family is the second word: `ariaCycle*`
// (wraparound), `ariaWrap*` (1-based step), `ariaTa*` (typeahead), `ariaAxis*` /
// `ariaOrientation*` / `ariaFlipped` / `ariaValueArrow` (orientation),
// `ariaSel*` / `ariaSingle*` (selection modes), `ariaBoolToken`. None of them is
// an attribute name: `ariaSelected`, `ariaExpanded`, `ariaOrientation`,
// `ariaMultiselectable`, ... stay each spec's OWN derived contract and must not
// be redefined here (a spec that imports this module would collide with them).
// State (focus, buffer) is passed IN and the next value comes back OUT; the
// pattern owns the vars. A `val` here would be inlined as an invariant into
// every importer, so invariants are predicate defs the importer wraps in a `val`.
//
// The generator inlines the whole closure into every importer's model and hashes
// every imported file, so editing this file makes every importer stale (run
// `generate:all`), and everything here must stay inside the generator subset:
// no collections, no `let`, no lambdas, no string concatenation, no recursion.
//
// Provided (the contract), with the specs that import each rule:
//   - wraparound: `ariaCycle0` / `ariaCycle1` (candidate k steps on, 0- / 1-based;
//     listbox-typeahead, combobox-select-only / treeview) and `ariaWrapNext1` /
//     `ariaWrapPrev1` (one step, 1-based, 0 = outside; menu-button, menu-menubar,
//     menu-checkable)
//   - typeahead start: `ariaTaStart0` / `ariaTaStart1` (a fresh buffer searches
//     from the item AFTER the current one, later characters from the current one
//     so refining a match keeps focus on it; listbox-typeahead / treeview) and
//     `ariaTaRepeatStart0` (the select-only combobox: the SAME character as the
//     last cycles from the item after the current one, a different one starts
//     again from the top; combobox-select-only)
//   - typeahead case: `ariaTaFold` / `ariaTaSameChar` fold ASCII A-Z to a-z
//     (APG: matching is case-insensitive). NO spec imports these yet: every
//     typeahead pool is lowercase or an integer code, so nothing exercises them
//   - orientation: `ariaOrientationKnown` ("horizontal" | "vertical"; tabs,
//     toolbar, slider, slider-multithumb, windowsplitter), `ariaAxisForward` /
//     `ariaAxisBackward` (only the arrow pair ALONG the axis moves; tabs),
//     `ariaFlipped` / `ariaValueArrow` (slider arrows raise / lower on both axes,
//     RTL mirrors the horizontal pair; slider, slider-multithumb)
//   - selection modes: `ariaSelModeKnown` / `ariaSelIsMulti` ("single" | "multi";
//     treegrid) and `ariaSingleHoldsAtMostOne` (no more than one selected /
//     expanded item without the multi flag; a controlled host owns the value;
//     accordion, treeview, treegrid, listbox-single, listbox-rearrangeable)
//   - attribute token: `ariaBoolToken` ("true" | "false" from a bool; accordion,
//     disclosure, treeview, treegrid, button)
//
// NOT provided, so still the pattern's own (the gap list):
//   - roving focus, Home / End, wrap policy of arrow navigation: shared/focusgroup
//     (`fg*`). The 1-based `ariaWrap*` here exist because the menus use 0 as
//     "outside"; `fgStep` is 0-based
//   - the typeahead SCAN itself: "the first item whose label starts with the
//     buffer" needs a label lookup per candidate, i.e. a function or collection
//     argument. A spec keeps its unrolled `if` chain and calls `ariaCycle*` for
//     the candidates. The same goes for the prefix test, which depends on how the
//     spec encodes names (base-4 digit code in listbox-typeahead, per-position
//     chars in treeview, a prefix trie in combobox-autocomplete, a one-letter code
//     in the menus) and for the buffer encoding itself
//   - the first-character policy of the listbox / tree (`ariaTaStart*`) and of the
//     select-only combobox (`ariaTaRepeatStart0`) are DIFFERENT rules; neither is
//     the other's special case. The menus search only after the current item with
//     a single character and use `ariaWrapNext1` directly
//   - the windowsplitter key mapping is the PERPENDICULAR axis (a vertical bar
//     moves with Left / Right), which no other spec shares; the toolbar's
//     orientation -> focusgroup axis (`axisOf`) has a single user
//   - roles, `aria-activedescendant`, `aria-expanded` and the other per-pattern
//     attribute derivations: each spec's contract, shapes differ. The one-line
//     `if (open) active else NONE` in the three combobox specs stays local: it
//     would only thread the spec's own `NONE` sentinel through a parameter
//   - "selection follows focus" (tabs automatic, treegrid / listbox single,
//     combobox-tree): the shape depends on the spec's selection encoding (bit
//     mask, one index, per-list masks), so only the cardinality rule is shared
//   - the bit-mask helpers (`bit`, `pow2`, `popcount`: 4 to 7 copies, each over
//     its own width) wait for `ipow` / `Set[int]` in the generator
//   - the controlled-value protocol (`holds` / `follows` / `verdict` / `landed` /
//     `propAfter`, 30+ copies) is not ARIA: it wants its own module
//
// NOT expressible as pure defs (no collections / vars / lambdas here), so NOT
// modelled:
//   - disabled and hidden items, a label per item, a dynamic item count: the
//     defs take the count `n` and assume every index is a candidate
//   - non-ASCII case folding (locale rules, ß, İ), IME composition, the timeout
//     of the buffer (a spec models it as an event), multi-character strings typed
//     in quick succession in the select-only combobox
//   - `aria-orientation` defaults per role and an absent / "undefined" orientation
//   Collections would lift the first group: see
//   docs/research/quint-generator-ui-extensions.md (item 6).
//
// Domains: `ariaCycle*` and `ariaWrap*` need n >= 1 and k >= 0; `ariaCycle*`
// return `cur` itself when n < 1 (no candidates) instead of dividing by zero.
module aria {
  // --- wraparound ----------------------------------------------------------
  // the item k steps after cur among n items, wrapping; k = 0 is cur itself
  // (0-based: items 0..n-1)
  def ariaCycle0(n: int, cur: int, k: int): int =
    if (n < 1) cur else (cur + k) % n
  // (1-based: items 1..n; cur = 0 reads as "before the first", the same as n)
  def ariaCycle1(n: int, cur: int, k: int): int =
    if (n < 1) cur else ((cur + k + n - 1) % n) + 1

  // one step on a ring of items 1..n, 0 = outside; n = 0 is the empty ring
  def ariaWrapNext1(i: int, n: int): int = if (i >= n) 1 else i + 1
  def ariaWrapPrev1(i: int, n: int): int = if (i <= 1) n else i - 1

  // --- typeahead -----------------------------------------------------------
  // where a search begins: after the current item for the first character of a
  // buffer, at the current item for the following ones
  def ariaTaStart0(n: int, cur: int, fresh: bool): int =
    if (fresh) ariaCycle0(n, cur, 1) else cur
  def ariaTaStart1(n: int, cur: int, fresh: bool): int =
    if (fresh) ariaCycle1(n, cur, 1) else cur

  // select-only combobox: the same character as the last cycles on from the item
  // after the current one, a different one starts again at the first item.
  // typedBefore is the last typed character (any value that is not a character,
  // e.g. -1, when the buffer is empty)
  def ariaTaRepeatStart0(n: int, cur: int, typedBefore: int, ch: int): int =
    if (typedBefore == ch) ariaCycle0(n, cur, 1) else 0

  // ASCII case fold: "A".."Z" -> "a".."z", everything else is unchanged
  def ariaTaFold(c: str): str =
    if (c == "A") "a"
    else if (c == "B") "b"
    else if (c == "C") "c"
    else if (c == "D") "d"
    else if (c == "E") "e"
    else if (c == "F") "f"
    else if (c == "G") "g"
    else if (c == "H") "h"
    else if (c == "I") "i"
    else if (c == "J") "j"
    else if (c == "K") "k"
    else if (c == "L") "l"
    else if (c == "M") "m"
    else if (c == "N") "n"
    else if (c == "O") "o"
    else if (c == "P") "p"
    else if (c == "Q") "q"
    else if (c == "R") "r"
    else if (c == "S") "s"
    else if (c == "T") "t"
    else if (c == "U") "u"
    else if (c == "V") "v"
    else if (c == "W") "w"
    else if (c == "X") "x"
    else if (c == "Y") "y"
    else if (c == "Z") "z"
    else c
  // two typed characters are the same character for repetition and matching
  def ariaTaSameChar(a: str, b: str): bool = ariaTaFold(a) == ariaTaFold(b)

  // --- orientation ---------------------------------------------------------
  def ariaOrientationKnown(o: str): bool = or(o == "horizontal", o == "vertical")

  // composite widgets that move along their axis only (tabs): the arrow ALONG the
  // axis steps forward / backward, the perpendicular pair is left to the page
  def ariaAxisForward(o: str, key: str): bool =
    or(and(o == "horizontal", key == "ArrowRight"), and(o == "vertical", key == "ArrowDown"))
  def ariaAxisBackward(o: str, key: str): bool =
    or(and(o == "horizontal", key == "ArrowLeft"), and(o == "vertical", key == "ArrowUp"))

  // sliders: the horizontal axis is visually mirrored in a right-to-left page
  def ariaFlipped(o: str, d: str): bool = and(o == "horizontal", d == "rtl")
  // +1 raises, -1 lowers, 0 for any other key; Up / Down work on both
  // orientations, Right / Left swap under RTL (multiply by the small step)
  def ariaValueArrow(key: str, o: str, d: str): int =
    if (key == "ArrowUp") 1
    else if (key == "ArrowDown") -1
    else if (key == "ArrowRight") (if (ariaFlipped(o, d)) -1 else 1)
    else if (key == "ArrowLeft") (if (ariaFlipped(o, d)) 1 else -1)
    else 0

  // --- selection modes -----------------------------------------------------
  // "single" selects at most one item, "multi" is aria-multiselectable
  def ariaSelModeKnown(m: str): bool = or(m == "single", m == "multi")
  def ariaSelIsMulti(m: str): bool = m == "multi"
  // APG: no more than one item selected (or expanded) without the multi flag. An
  // uncontrolled invariant: a controlled host owns the value and may hand us any set
  def ariaSingleHoldsAtMostOne(controlled: bool, multi: bool, cnt: int): bool =
    or(controlled, multi, cnt <= 1)

  // --- attribute tokens ----------------------------------------------------
  // aria-expanded / aria-pressed / aria-selected ... from a bool; an absent
  // attribute is the pattern's own token ("absent" or "none")
  def ariaBoolToken(b: bool): str = if (b) "true" else "false"
}
