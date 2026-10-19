# headless

Headless APG widgets for cssints-native: **state plus a neutral parts description**, with no DOM, no events and no JSX.
Ported from `@eoa/headless` (effects-of-atmosphere, commit `09f2185`, `packages/headless`) and checked against the
same Quint specs and ported scenarios. State is Solid 2 signals (`solid-js@2.0.0-rc.13`), which the Solid → Clay
renderer will read. Focus is the focus manager of `focus/`, which the groups register with.

Ported: `controllable` (request vs commit, verbatim), `button`, `switch`, `checkbox` (with `mixed`), `disclosure`,
`radio` (a group), `tabs`, `toolbar`, `slider`, `tree` (a group with expansion).

```sh
bun run test        # bun test --conditions browser: scenarios, Quint walks, unit tests
bun run typecheck   # tsc over src, test and vendor
```

`--conditions browser` matters: bun and node resolve `solid-js` to its **server** build, where a setter applies at once
and nothing batches. The client build is what the renderer runs (a setter applies on `flush()`), so the tests run on it;
`test/controllable.test.ts` fails if they do not.

## The parts

A primitive returns its state as accessors and its parts as plain objects. Every state field is a getter over a signal,
so reading it inside a Solid computation tracks it, and reading it outside gives the current value. A part carries what
the aria-* attributes carried, as fields, plus handlers.

| Primitive          | Parts                                  | Fields                                                                                                 |
| ------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `createButton`     | `part`                                 | `id`, `role: "button"`, `pressed` (`undefined` on a command button), `disabled`, `focused`             |
| `createSwitch`     | `part`                                 | `id`, `role: "switch"`, `checked`, `disabled`, `readOnly`, `focused`                                   |
| `createCheckbox`   | `part`                                 | `id`, `role: "checkbox"`, `checked: boolean \| "mixed"`, `disabled`, `readOnly`, `focused`             |
| `createDisclosure` | `trigger`, `panel`                     | trigger: `id`, `role: "button"`, `expanded`, `controls` (the panel's id), `disabled`, `focused`; panel: `id`, `hidden` |
| `createRadioGroup` | `group`, `radios[]`                    | group: `id`, `role: "radiogroup"`, `orientation`; radio: `id`, `role: "radio"`, `checked`, `disabled`, `focused`, `tabIndex`, `describedBy` |
| `createTabs`       | `tablist`, `tabs[]`, `panels[]`        | tablist: `id`, `role: "tablist"`, `orientation`; tab: `id`, `role: "tab"`, `selected`, `disabled`, `focused`, `tabIndex`, `controls`; panel: `id`, `role: "tabpanel"`, `labelledBy`, `hidden`, `focused`, `tabIndex` |
| `createToolbar`    | `toolbar`, `items[]`                   | toolbar: `id`, `role: "toolbar"`, `orientation`; item: `id`, `role: "button"`, `label`, `kind`, `disabled`, `focused`, `tabIndex` |
| `createSlider`     | `thumb`                                | `id`, `role: "slider"`, `valueNow`, `valueMin`, `valueMax`, `valueText`, `orientation`, `tabIndex: 0`, `focused` |
| `createTree`       | `tree`, `item(id)`                     | tree: `id`, `role: "tree"`, `label`, `multiSelectable`, `orientation` (`horizontal` only), `focused`; item: `id`, `role: "treeitem"`, `label`, `level`, `posInSet`, `setSize`, `expanded` (`undefined` on an end node), `selected`, `disabled`, `focused`, `tabIndex`, `hidden` |

`id` is a stable string, `<id>-trigger` / `<id>-panel` from the `id` option, or `<kind>-<n>` in creation order when it
is not given; Clay hashes it, so pass `id` where the order can change. `controls` and `labelledBy` are ids, as
`aria-controls` and `aria-labelledby` were; `describedBy` is the string as given.

`createTree` takes the flat node list of eoa's primitive (`{ id, parent, label }`, `parent: 0` for a root, order is
document order) and returns `tree` plus `item(id)`. Up/Down/Home/End are the focus manager's; Right opens a closed
item and steps into an open one, Left closes an open item and steps to the parent; Space selects (toggles with
`selection: 'multiple'`), Enter opens/closes and selects in single-select, `*` opens the focused item's siblings.
Multi-select's `Shift+ArrowDown` / `Shift+ArrowUp` and `Control+a` / `Meta+a` are key names, since a part gets a key
string, not an event. Type-ahead is not ported.

Handlers on every interactive part (`PartHandlers`):

| Handler                | Meaning                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `press()`              | pointer activation: the pointer was released over the part                                           |
| `keyDown(key, repeat?)`, `keyUp(key)` | one key event; returns whether the part consumed it, so the host lets Tab and arrows fall through |
| `key(key)`             | `keyDown` then `keyUp`                                                                               |
| `focus()`, `blur()`    | the host's focus manager gave or took focus                                                          |

Keys are APG's: Enter fires on key down, Space is armed on key down and fires on key up, a blur or disabling drops an
armed Space (the native `<button>` behaviour, which the DOM version got for free). A switch takes Enter only with
`enterToggles`; a checkbox never does. The host decides which part holds focus and routes keys to it; a part does not
check its own `focused`. `focus()` on a disabled disclosure trigger does nothing (a native disabled button cannot
focus); button, switch and checkbox use aria-disabled semantics and stay focusable.

Three parts that hold no focus are containers, `group` (radio), `tablist` and `toolbar`. Their `keyDown` takes Tab from
outside: it enters the group at its tab stop. A group's items are the only focus stops of the group.

Pressed *look* (`:active`) is not part state: it is pointer-down-over-the-part, which Clay already answers
(`Clay_PointerOver`); the primitive only reacts to the release (`press()`).

### Request vs commit

As in eoa: `value` + `onValueChange` is controlled (the host owns the state; the callback is a request it may ignore),
`defaultValue` is uncontrolled, and `setX`/`toggle`/`expand`… are requests too. Options are read lazily; pass an object
with getters, never destructured values.

## Focus

The groups use the focus manager (`focus/`) where eoa used `document.activeElement`, `element.focus()` and the
browser's roving tabindex. `createFocusHost(manager?)` (`src/focus-host.ts`) is the seam: a primitive takes a `focus`
option or makes its own manager; reads go to the manager fresh (`focused()`, `tabOrder()`), and a Solid `version`
signal tells readers to read again, since the manager is plain TypeScript. Items are registered in registration order
(the manager's document order), and their owner's disposal unregisters them.

To share one manager across widgets, so that Tab crosses from one to the next, pass the same `focus` to each. The tests
do this (`test/roving.test.ts`).

| Primitive | Group in the manager                                                                                              | Tab in / out                                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| radio     | `orientation: both`, `wrap`, no memory, `entry` = the checked radio (read lazily, so it follows the check); disabled radios skipped | in: the checked radio, else the first enabled; out: the next stop |
| tabs      | `orientation` as the option (arrows of that axis), `wrap`, no memory, `entry` = the selected tab (or the first enabled, if it is disabled); disabled tabs skipped | in: the selected tab; out: the selected panel (it is a stop after the tablist unless it holds focusable content of its own), then the next |
| toolbar   | `orientation`, `wrap` (optional), `memory`, `focusDisabled` (a disabled item stays reachable, as `aria-disabled` items do in APG) | in: the item focused last, else the first; out: the next stop. A `text` item keeps the arrows of its axis, a `spin` item Up, Down, Home and End; a Tab from a `text` item steps to its neighbour |
| slider    | not a group: one entry. Arrows, Page keys, Home and End are the slider's own, not the manager's                    | the host's Tab reaches the thumb like any entry             |
| tree      | `orientation: vertical`, no wrap (eoa clamps at the ends), no memory, `entry` = the first selected visible item, else the first visible; a node inside a collapsed subtree is registered with `tabIndex: -1`, so it is not in the group and is no Tab stop | in: the entry; out: the next stop. Up/Down/Home/End are the manager's; Left/Right are the tree's own. `focus()` on the tree gives focus to the roving item (the spec keeps it, see the divergences) |

Selection follows focus only where APG says so: radio checks on the arrow keys and on Space; tabs select on the arrow
or Home/End only with automatic activation (manual waits for Enter or Space), and a click selects. Tab itself moves
focus through the manager, so a part that has focus hands Tab to it.

`focus/` changed for types only, to take an explicit `undefined` for `group` under `exactOptionalPropertyTypes`; its
tests are unchanged and still pass (`node focus/test/focus.test.ts`).

## A Clay page

The styles are cssints (`example/styles.ts`, checked to compile with `generator/clay-header.ts`): Clay has no states, so
the pressed look is a style of its own (`track_active`) and the checked look another (`trackOn`).

```ts
import { createSwitch } from "@cssints-native/headless";

const sw = createSwitch({ defaultValue: false });   // or value / onValueChange: the page owns the state
const { part } = sw;

// per frame, in the renderer's tree builder: the style comes from part fields and the pointer
const pressed = clayPointerOver(part.id) && pointer.down;
const style = part.checked ? (pressed ? trackOn_active : trackOn) : pressed ? track_active : track;
CLAY(part.id, style, { focusRing: part.focused });

// input, from the host's event loop
if (pointer.releasedOver(part.id)) part.press();
if (focusedId === part.id) consumed = part.keyDown(key);   // part.keyUp(key) on release; part.key(key) for a whole press
// whoever owns focus calls part.focus() / part.blur()
```

The accessibility tree (AccessKit later) reads the same fields: `role`, `checked`, `selected`, `disabled`, `expanded`,
`controls`, `hidden`, `tabIndex`, `orientation`, `valueNow`. This renderer does not exist yet (`solid/` builds it); the
snippet is the contract it will use, not running code.

## How it is checked

Unchanged from eoa: signals at run time, the generated Quint model as the oracle in tests, never loaded at run time.

- `test/neutral-driver.ts` is eoa's `dom-driver` on neutral parts. It turns scenario steps into handler calls
  (`click` = `focus()` then `press()`, `key` = `focus()` if needed, `keyDown`, `keyUp`, `prop` = the mount's host) and reads
  the probe back from part fields (`aria-checked` ← `checked`, `aria-pressed` ← `pressed`, `aria-expanded` ← `expanded`,
  `aria-selected` ← `selected`, `aria-level` ← `level`, `aria-posinset` ← `posInSet`, `aria-setsize` ← `setSize`,
  `aria-multiselectable` ← `multiSelectable`, `aria-label` ← `label`, `tabindex` ← `tabIndex`, `aria-orientation` ← `orientation`, `aria-valuenow` ← `valueNow`,
  `aria-valuetext` ← `valueText`, `aria-labelledby` / `aria-controls` ← the part an id names, `hidden`, `aria-readonly`,
  `role`, focus ← `focused`, visible ← `hidden === false`). An attribute no part field carries reads as absent, as an
  unset attribute did; `data-*` is `Unsupported`. Solid's `flush()` runs after every handler call, as every input event of
  a real host is its own tick.
  - A `key` step with `phase: 'down' | 'up'` is one half of a press: `down` focuses and calls `keyDown` only, `up` calls
    `keyUp` only and does not re-focus, so a keydown → blur → keyup walk reaches the part after the blur. A whole `key`
    step still calls the pair.
  - The slider's `configure` variant (step / large step / start) is the bridge's setup event; the mount creates the
    primitive with the same `step`, `largeStep` and `value` from `sliderConfig`, so no run-time setter is needed.
  - Three options it takes for the eoa behaviour the primitives share: `disabledReads: 'token'` reads `aria-disabled` as
    `true` or `false` (radio wrote it so); `keys: 'focused'` sends a key step to whichever part holds focus, falling
    back to its target (the tabs spec routes keys through its own focus cursor, and eoa's tabs driver did the same);
    `readEvents: 'consumed'` returns only the events since the previous read (eoa's DOM driver did, and the treeview APG
    scenarios expect it), while the walk always keeps the cumulative lists of `specDriver`.
- `test/mounts.ts` is eoa's fixtures without JSX: it creates the primitive and acts as the host (a signal passed as
  `value`, written back only when the host `accepts`). A config the port does not implement throws `Unsupported` in the
  mount (the toolbar's `menutrigger`, which a scenario reaches; the tabs' `deletable` and the radio's `flavor:
  activedescendant`, which no scenario uses); `conformance` counts that as unsupported, as it counts a bridge gate.
- `test/conformance.ts` runs, per primitive, the two checks of eoa's browser test: `replayScenario` over every ported
  scenario, and `differentialWalk` (15 runs × 25 steps, seed 7) between `specDriver` over the generated model and the
  neutral driver. The count of passed and unsupported scenarios is pinned, so a bridge or scenario change that skips more
  shows up.
- `test/roving.test.ts` is what the walks and scenarios do not reach: activation on Enter and Space, a text item's keys,
  wrap only when asked, a disabled item that stays focusable, memory on re-entry, slider steps and page keys, valueText,
  and one manager shared by tabs and toolbar with disposal.

| Primitive  | Scenarios | Passed | Unsupported (a gate) | Divergences (still failing) | Walk configs |
| ---------- | --------- | ------ | -------------------- | --------------------------- | ------------ |
| button     | 55        | 7      | 41                   | 7                           | 10           |
| switch     | 42        | 8      | 28                   | 6                           | 9            |
| checkbox   | 89        | 12     | 72                   | 5                           | 11           |
| disclosure | 65        | 31     | 26                   | 8                           | 7            |
| radio      | 56        | 18     | 36                   | 2                           | 5            |
| tabs       | 56        | 36     | 17                   | 3                           | 6            |
| toolbar    | 84        | 10     | 63                   | 11                          | 2            |
| slider     | 52        | 1      | 51                   | 0                           | 10           |
| treeview   | 35        | 26     | 7                    | 2                           | 8            |

**Unsupported (a gate)** is what the bridge refuses (a config key or step it does not translate, or a step field the
replay does not know), plus, for one scenario, the mount's refusal (the toolbar's menu-button item). The bridge gates most of the 52 slider
scenarios: the spec carries two configurations only (range 0..10, step 1 / large step 3 / start 5, and step 2 / large
step 4 / start 6) and models no drag, so only one passes. A scenario the mount refuses is the port's own gate, not a
divergence. The treeview's seven are three bridge gates (the `modifiers` on the Shift/Ctrl steps) and four driver gates
(`type` / `typeaheadReset`, since type-ahead is not ported). No gate is left for the key halves: the button, checkbox and
switch bridges honour `phase`, and their walks draw keydown Space, blur, keyup Space.

The walk configs are eoa's, with four changes, each for a reason the port has:

- **radio:** no `flavor` steps (the port has the roving flavour only) and the `activedescendant` config is gone with it.
  Controlled walks keep eoa's filter (no `preselect` or `disabled` steps). Five walks: uncontrolled, checked, disabled,
  controlled accepting, controlled pinned.
- **toolbar:** the spec's item 0 is a menu-button, and the menu is not ported. The walk runs with a plain button there,
  and the alphabet leaves out the steps that would open the spec's menu on it: `activate`, `click 0`, `flipOrientation`
  (it would turn the other arrow into the open key), and the arrow of the other axis (a menu-button takes it as its open
  key). Item 0's `aria-haspopup` and `aria-expanded` are the menu's, so the probe does not read them. The walk's
  activation coverage is the unit test's, since an activation has no observable effect but the menu.
- **tabs:** the eoa configs as they are; the port reads `keys: 'focused'`. The alphabet now carries ArrowUp/ArrowDown,
  so the vertical walk moves along its axis and notices a tablist that does not wrap.
- **slider:** eoa's ten configs as they are: uncontrolled, vertical, right-to-left, both, the step-2 walk in plain and
  right-to-left, then a controlled host that accepts or pins the value, the last one vertical and one on the step-2
  variant. The step-2 walks are what let a walk see arrows that ignore `step`.
- **treeview:** eoa's eight configs as they are (uncontrolled single and multi, a pinned selection and roving node,
  then a controlled host that accepts, one that holds, the same in multi-select, and both pinned). The alphabet leaves
  out the `type` / `typeaheadReset` steps, since type-ahead is not ported; the four scenarios that type are then
  unsupported rather than failing. The `modifiers` on the Shift/Ctrl scenarios are an extended step field the vendored
  bridge does not opt into, so those three scenarios are gated too; multi-select is walked through Space and checked by
  the unit test's `Shift+ArrowDown` / `Control+a` key names.

**Divergences** are eoa's maps with their reasons, all carried over, none added, none dropped: each scenario still fails,
and the test requires it to (a closed gap forces removing the entry). For radio: the native `<input type=radio>` attribute
and the per-radio focus callbacks. For tabs: the axis of the arrows in a vertical stack, the disabled-tab skip (base-ui
moves onto a disabled tab), and one panel-tabindex convention. For toolbar: the disabled-item skip, the Composite
initial tab stop and role, and the toggle group: each is a base-ui or ariakit behaviour the spec does not model. For
treeview: the two focus-on-entry scenarios (APG focuses the selected node when the tree receives focus; the treeview
spec, and the primitive with it, keep the roving node, so `focus()` restores that node). None is a browser focus quirk.
`disabledAttr` in each test says which attribute spells `disabled`.

### Mutation checks

Each run breaks one behaviour, runs the tests, and reverts (the file compared with its backup afterwards).

| Widget     | Break                                                                 | Result                                                                                                       |
| ---------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| tabs       | `wrap: false` in the group                                            | 12 fail: 6 of 6 walks (the vertical one now sees Up/Down), 4 scenarios, the pinned count, 1 unit test         |
| radio      | an arrow moves focus without checking the radio                       | 9 fail: 5 walks, 1 scenario, the pinned count, 2 unit tests                                                  |
| slider     | arrows ignore `step` (move by 1)                                      | 4 fail: 3 step-2 walks and the unit test (was 1: the unit test alone)                                        |
| slider     | `Math.sign` on the change (ignores `step` and `largeStep`)            | 12 fail: 10 walks, 2 unit tests                                                                              |
| toolbar    | a `text` item does not keep its arrows                                | 3 fail: 2 walks, 1 unit test                                                                                 |
| treeview   | Right does not expand a closed item                                   | 11 fail: 8 walks, 1 scenario (`right-opens-closed-node`), the pinned count, 1 unit test                      |
| treeview   | a collapsed subtree stays in the group (every item `tabIndex: 0`)     | 12 fail: 8 walks, 2 scenarios (`down-skips-collapsed-subtrees`, `up-moves-to-previous-visible`), the pinned count, 1 unit test |
| pressable  | a blur keeps an armed Space (button, checkbox, switch share it)       | 15 fail: 6 button walks, 9 checkbox walks. The switch walks do not draw down→blur→up with seed 7             |
| controllable | the change callback fires only when uncontrolled (eoa's mutation, all patterns) | 39 fail (was 38 before the three new slider walks)                                      |

The slider row was the blind spot: eoa's slider spec used to fix `step`, so its tests could not tell a slider that ignores
it. The step-2 variant in `slider.qnt` closes it; the unit test is no longer the only check. The pressable row is the
complement: before the key halves, no walk could draw Space down, blur, Space up, so a pressable that kept the press armed
after a blur passed every test. The new halves exposed one more divergence on the way: `createButton` did not disarm on
`disabled` (switch and checkbox did), which `test/button.test.ts` now catches; `src/button.ts` watches the option and
disarms.

## Vendored

`vendor/` holds the spec side, copied **read-only** from effects-of-atmosphere at `09f2185` (`EOA_COMMIT`); see
[vendor/README.md](vendor/README.md). `sync.sh` reads the files from git at that commit, so the eoa checkout may be on
another one. `effect@4.0.0` is the one dependency it needs.

## Left

- **Menu, menu button, menubar** (eoa's `menu.ts`): the toolbar's menu-button item and the scenarios that use it are the
  gate; the walk leaves the menu out, as above.
- **Radio `flavor: activedescendant`**: the group takes focus and names the radio by id, which is not a focus entry.
- **Tabs `deletable`** (the Delete key removes a tab) and RTL in the tabs bridge (gated).
- **Slider** dragging (pointer capture and move) beyond a press: `pointer(ratio)` is the press; a host that drags calls
  it per position. Multi-thumb is eoa's `slider-multithumb`, not ported.
- **Tree type-ahead** (`type` / `typeaheadReset`): the four scenarios that type are gated, and the walk leaves those
  steps out. The spec models a two-character buffer with an explicit reset; a consumer that wants it needs the buffer
  and a timer. **Tree drag-and-drop** is a spec `skipped` entry, not part of the APG state machine.
- **Tree multi-select modifiers**: the primitive handles `Shift+ArrowDown` / `Shift+ArrowUp` and `Control+a` /
  `Meta+a`, but the scenarios that use them carry the `modifiers` extended step field, which the vendored bridge does
  not translate, so they are unsupported (as they are in eoa's browser test).
- **Overlays** (dialog, tooltip, menu button), **text input** and the caret, and the rest of eoa's patterns (they port the
  same way: a bridge, a mount, a `conformance` call).
- **The Solid → Clay renderer** that consumes the parts (`solid/`), and an accessibility tree from them.
- Pointer arming (`pointer_down` … `pointer_cancel`) is not a primitive state: `press()` is the release. The spec models
  it, eoa's DOM primitive did not either, and its scenarios on it are `data-pressed` ones, skipped.
- **Walk coverage the eoa alphabets do not have:** the switch's seeded draw does not happen to emit keydown Space → blur
  → keyup Space (the button and checkbox walks do), so the shared pressable's blur disarm is proved through those two.
  The tabs and slider alphabets now match eoa's, including Up/Down and the step-2 variant.
