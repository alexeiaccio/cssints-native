# headless

Headless APG widgets for cssints-native: **state plus a neutral parts description**, with no DOM, no events and no JSX.
Ported from `@eoa/headless` (effects-of-atmosphere, commit `09f2185`, `packages/headless`) and checked against the
same Quint specs and ported scenarios. State is Solid 2 signals (`solid-js@2.0.0-rc.13`), which the Solid → Clay
renderer will read. Focus is the focus manager of `focus/`, which the groups register with.

Ported: `controllable` (request vs commit, verbatim), `button`, `switch`, `checkbox` (with `mixed`), `disclosure`,
`radio` (a group), `tabs`, `toolbar`, `slider`, `tree` (a group with expansion), `dialog-modal` (a modal trap),
`menu` (`createMenu`: the plain, checkbox, radio and mixed menus) and `menubar` (`createMenubar`: the roving bar with a
menu per item and one more level of submenus).

Ours, **not ported**: `createTextField`. eoa has no textfield primitive (`combobox` and `spinbutton` are text-like but
model their own patterns) and `specs/apg/` has no textbox pattern, so there is no vendor file, mount, scenario or walk
behind it, and the counts below are unchanged by it.

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
| `createDialogModal`| `trigger`, `dialog`, `backdrop`, `dismiss` | trigger: `id`, `role: "button"`, `hasPopup: "dialog"`, `expanded`, `controls`, `disabled`, `focused`; dialog: `id`, `role` (`dialog` / `alertdialog`), `modal`, `labelledBy`, `describedBy`, `tabIndex: -1`, `hidden`, `keyDown`; backdrop: `id`, `hidden`, `press`; dismiss: `id`, `role: "button"`, `focused` |
| `createMenu`       | `trigger`, `menu`, `item(i)`           | trigger: `id`, `role: "button"`, `hasPopup: "menu"`, `expanded`, `controls`, `disabled`, `focused`, `tabIndex: 0`; menu: `id`, `role: "menu"`, `hidden`; item: `id`, `label`, `role` (`menuitem` / `menuitemcheckbox` / `menuitemradio`), `kind`, `checked` (`undefined` on a plain item), `disabled`, `focused`, `tabIndex` |
| `createMenubar`    | `menubar`, `item(bar)`, `menu(bar)`, `menuItem(bar, item)`, `submenu(bar, item)`, `submenuItem(bar, item, sub)` | menubar: `id`, `role: "menubar"`, `orientation`; bar item: `id`, `role: "menuitem"`, `label`, `hasPopup: "menu"` (only with a menu), `expanded` (`undefined` without a menu), `tabIndex`, `disabled`, `focused`; menu: `id`, `role: "menu"`, `hidden`; menu item and submenu item: `id`, `label`, `hasPopup` (only with a submenu), `expanded`, `tabIndex`, `disabled`, `focused` |
| `createTextField`  | `part`                                 | `id`, `role: "textbox"`, `value`, `caret`, `selection` (`{start, end}`), `valueText`, `readOnly`, `disabled`, `focused`, `tabIndex: 0`, `editsText` (a part that takes typed characters) |

`id` is a stable string, `<id>-trigger` / `<id>-panel` from the `id` option, or `<kind>-<n>` in creation order when it
is not given; Clay hashes it, so pass `id` where the order can change. `controls` and `labelledBy` are ids, as
`aria-controls` and `aria-labelledby` were; `describedBy` is the string as given.

`createTree` takes the flat node list of eoa's primitive (`{ id, parent, label }`, `parent: 0` for a root, order is
document order) and returns `tree` plus `item(id)`. Up/Down/Home/End are the focus manager's; Right opens a closed
item and steps into an open one, Left closes an open item and steps to the parent; Space selects (toggles with
`selection: 'multiple'`), Enter opens/closes and selects in single-select, `*` opens the focused item's siblings.
Multi-select's `Shift+ArrowDown` / `Shift+ArrowUp` and `Control+a` / `Meta+a` are key names, since a part gets a key
string, not an event. Type-ahead is not ported.

`createDialogModal` is the trigger, the dialog container, the backdrop and the dismiss button; `add(part)` registers a
content control in the focus manager and in the dialog's Tab cycle (call it once per control, not once per open — the
controls stay known while the dialog is closed), and `keyDown` is the modal trap: Tab and Shift+Tab cycle the content
controls and wrap, Escape closes unless `keyboardDismissDisabled`. Opening (the committed `open`, uncontrolled or
written by a controlled host) moves focus to the first content control and remembers what held it; closing returns it
there. The page gives every key to `keyDown` while the dialog is open (`input.modal` in `solid/src/input.ts`). The
dialog container itself is not focusable, as the spec's `dialog-modal.qnt` says. `dismissable: false` makes the backdrop
inert; the page passes it, since a press on a modal's backdrop does nothing.

`createMenu` (`items`, `variant`: `plain` / `checkbox-items` / `radio-items` / `mixed`, `triggerMode`:
`outside` (menu button) or `held` (checkable menu), `disabled`, `defaultChecked` / `defaultChoice` /
`defaultValue`, controlled packed `value` + `onCheckedValueChange`) is the menu button and its flat menu. Enter, Space,
Down and Up on the trigger open on the first/last item; in the menu the arrows move and wrap, Home and End go to the
ends, Escape closes and returns focus to the trigger, Tab closes and lets focus leave, Enter activates and closes,
Space activates without closing a checkable item. Disabled items stay focusable (APG note 1) and are not activatable.
Type-ahead is `type(text)` (a 500 ms buffer) and the spec's index codes as `typeaheadCode(code)`.

`createMenubar` (`items`: a label or `{ label, menu, disabled }`, each menu item a label or `{ label, submenu,
disabled }`; `orientation`, `onActivate(path)`, `onOpenChange(openTop)`) is the roving bar: one bar item is the Tab stop
(`barStop`), `focusIn` lands on it, Right/Left move along the bar and open the next item's menu when one was open,
Down/Up open the bar item's menu on its first/last item and move inside a menu with wrapping, Home and End go to the ends,
Enter and Space open a parent (a bar item's menu or an item's submenu) or activate a leaf (every menu closes and focus
returns to the bar item), Escape closes the innermost open menu and returns focus to its invoker, a click on a bar item
toggles its menu and a click on a leaf closes everything. The bar items are one group of the focus manager; the items of
the open top menu and of the open submenu are groups registered while they are open, so a host's Tab finds them and the
menus are not Tab stops when closed. A bar item without a menu is a plain `menuitem` (no `aria-haspopup`/`aria-expanded`)
and its click is the host's, as APG's navigation variant expects. Not ported: hover opening, the vertical bar's
navigation (the keys stay the spec's horizontal ones), a controlled `value`, type-ahead, and disabled items in the keys
(the spec models none; the parts carry `disabled` and the manager keeps them focusable).

Handlers on every interactive part (`PartHandlers`):
`createTextField` (`id`, `focus`, `value` + `onValueChange` controlled / `defaultValue` uncontrolled, `maxLength`,
`readOnly`, `disabled`, `advance`, `onSubmit`) is **ours**: no vendor model, no walk, the platform's `<input type=text>`
rules written down. It is one focus entry that registers itself in the manager it is given (as the slider does), so the
page `input.bind(part)`s it. `insert(text)` replaces the selection with `text` at the caret (clamped to `maxLength`
without cutting a surrogate pair) and leaves the caret after it; `keyDown` takes Backspace, Delete, the arrows, Home and
End (`Shift+…` on the arrows/Home/End extends the selection from an anchor), Enter (`onSubmit`, once: a repeat does not
fire it again) and Escape (blur); `press(x, advance)` focuses and puts the caret from a pointer x measured from the text
run's start, `advance` px a character — a fixed advance, so a proportional font can be a character off, and the ends
clamp. `clipboard(op, text)` is copy/cut (it returns the selected text) and paste (it inserts). `editsText` is false
while the field is read-only or disabled: a host uses it to know whether to run its text input at all. An index is a
UTF-16 code unit, as `selectionStart` is; bidi, wrapping, multiline, undo and IME composition state are not modelled.
Checked by `test/textfield.test.ts` (26 unit tests: insert at the caret and a run at once, the change callback,
`maxLength`, surrogate pairs, a selection replaced, Backspace and Delete, Home/End, the arrows collapsing and extending,
ordered selections, focus/blur and Escape, Enter once, presses, copy/cut/paste, the read-only and disabled fields, a
controlled host, and the part's fields).

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
| dialog    | a trap, not a group: the contents the page `add`s are the only stops Tab may visit while it is open. Not the manager's `tab`: `dialog.keyDown('Tab')` wraps them itself, so focus can never leave | in: the first content control (`open` moves focus there); out: only by closing. Escape closes and returns focus to what held it (the trigger). The container is not a focus entry |
| menu      | the items are a group (`orientation: vertical`, `wrap`, no memory, `focusDisabled`: a disabled item stays focusable) registered while the menu is open; the trigger is a plain entry before them. The arrows are the primitive's (the spec's transitions), which move focus through the manager | in: the trigger; while open the items are one stop. Tab closes and leaves (from the trigger the manager moves, from an item its unregistration relocates). A blur while focus is outside the widget closes the menu |
| menubar   | the bar items are a group (`orientation` as the option, `wrap`, no memory, `focusDisabled`, `entry` = the roving item); the items of the open top menu and of the open submenu are two more groups, registered only while they are open. All transitions are the primitive's (the spec's), and each moves focus through the manager | in: the roving bar item (`barStop`); out: Tab closes everything and leaves. Escape closes the innermost menu and focuses its invoker (the bar item or the parent menu item); a blur that leaves the widget closes everything |

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
| dialog-modal | 161     | 32     | 112                  | 17                          | 5            |
| menu (button) | 114    | 19     | 86                   | 9                           | 1            |
| menu (checkable) | 34 | 16     | 14                   | 4                           | 4            |
| menubar    | 74        | 26     | 30                   | 18                          | 1            |

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
- **dialog-modal:** eoa's five configs as they are (uncontrolled, open at mount, then a controlled host that holds the
  open state, closed and open). The walk is the bridge's: it compares role, `aria-modal`, `visible` (the dialog only —
  `hideable: ['dialog']`, the backdrop is not the pattern's visible state) and `onOpenChange`; the bridge's `focus` is
  an `Unsupported` (the spec encodes focus as example-specific targets). The trap is the unit test's
  (`test/dialog.test.ts`): the bridge gates every `key Tab` step, so no scenario draws one.
- **menu:** eoa's single plain config (four items, the third disabled) and the checkable spec's four (the mixed five-item
  menu, then controlled hosts that accept the packed value, accept with a value, and hold it). The walk compares the
  trigger's `aria-haspopup` / `aria-expanded`, the menu's `hidden`, the items' `role`, `aria-disabled`,
  `aria-checked` and `tabindex`, `visible`, and the focused part. The plain and checkable runs are split by the
  scenario's `variant` config, as eoa split them: 114 plain, 34 checkable.
- **menubar:** eoa's single config, the spec's fixed tree (File with New, More (a submenu of One and Two) and Close;
  Edit with Undo and Redo; About with no menu), uncontrolled; the config's `items` only names the labels. The walk draws
  `focus`, `leave` and the nine keys, and compares the bar items' `aria-haspopup` / `aria-expanded` / `tabindex`, the
  menus' `hidden`, the focused part, and `visible`. It goes to whichever part holds focus and is a no-op when none does,
  as eoa's parts driver did (the spec's keys are inert outside the widget). The scenario files are named
  `menubar.*.json` (not `menu-menubar.*.json`); `vendor/sync.sh` copies them under that prefix.

**Divergences** are eoa's maps with their reasons, carried over; each scenario still fails,
and the test requires it to (a closed gap forces removing the entry). For radio: the native `<input type=radio>` attribute
and the per-radio focus callbacks. For tabs: the axis of the arrows in a vertical stack, the disabled-tab skip (base-ui
moves onto a disabled tab), and one panel-tabindex convention. For toolbar: the disabled-item skip, the Composite
initial tab stop and role, and the toggle group: each is a base-ui or ariakit behaviour the spec does not model. For
treeview: the two focus-on-entry scenarios (APG focuses the selected node when the tree receives focus; the treeview
spec, and the primitive with it, keep the roving node, so `focus()` restores that node). For the menubar: the scenarios
that describe the upstream fixtures' own menu trees (a different number of items, the submenu on another item, a bar item
with no menu), vertical navigation (the spec models a horizontal bar only), hover opening (an ariakit/base-ui extension),
focus on a popup container instead of the first menu item, and focus on the menu container. `disabledAttr` in each test
says which attribute spells `disabled`.

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
| dialog     | the trap is off (Tab falls through to the manager)                    | 4 fail: 3 asserts of `solid/dialog.test.ts` (Tab and Shift+Tab leave the dialog, the page's trigger becomes a stop) and the unit test's trap check |
| menu       | Escape closes without returning focus to the trigger                  | 12 fail: 6 ported scenarios (the ariakit/base-ui focus-restore ones), the pinned count, the walk, 4 asserts of `solid/dialog.test.ts` |
| menubar    | Escape from a menu sets the roving item to the first bar item (no focus return to the invoker) | 2 fail: the walk (it compares the focused part after every step) and the unit test's Escape check. No scenario draws it (its Escape steps are carried divergences) |
| textfield  | `insert` puts the text at the start instead of the caret              | 7 fail: `test/textfield.test.ts` (the caret, a run, the change callback, `maxLength`, a replaced selection, the paste, the controlled host) and 2 asserts of `solid/field.test.ts` |

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

- **Menubar** (eoa's `createMenubar`) is ported except hover opening, the vertical bar's navigation keys, a controlled
  open menu, type-ahead and disabled items as keys. The toolbar's `menutrigger` item (a menu button) is still the
  toolbar mount's gate: it is a toolbar item, not the menu button, and the page uses `createMenu` for its menu button.
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
- **Overlays** beyond the dialog (tooltip, popover) and the rest of eoa's patterns (they port the same way: a bridge, a
  mount, a `conformance` call). **The text field** is ours, not theirs: no textbox pattern exists in `specs/apg/`, so
  there is nothing to port or check against, and what the model leaves out (bidi, grapheme clusters, wrapping,
  multiline, undo, IME composition state, drag-select) is listed above.
- **The Solid → Clay renderer** that consumes the parts (`solid/`), and an accessibility tree from them.
- Pointer arming (`pointer_down` … `pointer_cancel`) is not a primitive state: `press()` is the release. The spec models
  it, eoa's DOM primitive did not either, and its scenarios on it are `data-pressed` ones, skipped.
- **Walk coverage the eoa alphabets do not have:** the switch's seeded draw does not happen to emit keydown Space → blur
  → keyup Space (the button and checkbox walks do), so the shared pressable's blur disarm is proved through those two.
  The tabs and slider alphabets now match eoa's, including Up/Down and the step-2 variant.
