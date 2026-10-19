# headless

Headless APG widgets for cssints-native: **state plus a neutral parts description**, with no DOM, no events and no JSX.
Ported from `@eoa/headless` (effects-of-atmosphere, commit `8b72109`, `packages/headless`) and checked against the
same Quint specs and ported scenarios. State is Solid 2 signals (`solid-js@2.0.0-rc.13`), which the Solid → Clay
renderer will read.

Ported: `controllable` (request vs commit, verbatim), `button`, `switch`, `checkbox` (with `mixed`), `disclosure`.

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

| Primitive    | Parts                       | Fields                                                                                       |
| ------------ | --------------------------- | -------------------------------------------------------------------------------------------- |
| `createButton`     | `part`                | `id`, `role: "button"`, `pressed` (`undefined` on a command button), `disabled`, `focused`   |
| `createSwitch`     | `part`                | `id`, `role: "switch"`, `checked`, `disabled`, `readOnly`, `focused`                         |
| `createCheckbox`   | `part`                | `id`, `role: "checkbox"`, `checked: boolean \| "mixed"`, `disabled`, `readOnly`, `focused`   |
| `createDisclosure` | `trigger`, `panel`    | trigger: `id`, `role: "button"`, `expanded`, `controls` (the panel's id), `disabled`, `focused`; panel: `id`, `hidden` |

`id` is a stable string, `<id>-trigger` / `<id>-panel` from the `id` option, or `<kind>-<n>` in creation order when it
is not given; Clay hashes it, so pass `id` where the order can change. `controls` is an id, as `aria-controls` was.

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

Pressed *look* (`:active`) is not part state: it is pointer-down-over-the-part, which Clay already answers
(`Clay_PointerOver`); the primitive only reacts to the release (`press()`).

### Request vs commit

As in eoa: `value` + `onValueChange` is controlled (the host owns the state; the callback is a request it may ignore),
`defaultValue` is uncontrolled, and `setX`/`toggle`/`expand`… are requests too. Options are read lazily; pass an object
with getters, never destructured values.

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

The accessibility tree (AccessKit later) reads the same fields: `role`, `checked`, `disabled`, `expanded`, `controls`,
`hidden`. This renderer does not exist yet (`solid/` builds it); the snippet is the contract it will use, not running code.

## How it is checked

Unchanged from eoa: signals at run time, the generated Quint model as the oracle in tests, never loaded at run time.

- `test/neutral-driver.ts` is eoa's `dom-driver` on neutral parts. It turns scenario steps into handler calls
  (`click` = `focus()` then `press()`, `key` = `focus()` if needed, `keyDown`, `keyUp`, `prop` = the mount's host) and reads
  the probe back from part fields (`aria-checked` ← `checked`, `aria-pressed` ← `pressed`, `aria-expanded` ← `expanded`,
  `hidden`, `aria-controls` ← `controls` as the part it names, `aria-readonly`, `role`, focus ← `focused`, visible ← `hidden === false`).
  An attribute no part field carries reads as absent, as an unset attribute did; `data-*` is `Unsupported`.
  Solid's `flush()` runs after every handler call, as every input event of a real host is its own tick.
- `test/mounts.ts` is eoa's fixtures without JSX: it creates the primitive and acts as the host (a signal passed as
  `value`, written back only when the host `accepts`).
- `test/conformance.ts` runs, per primitive, the two checks of eoa's browser test: `replayScenario` over every ported
  scenario, and `differentialWalk` (15 runs × 25 steps, seed 7) between `specDriver` over the generated model and the
  neutral driver. The count of passed and unsupported scenarios is pinned, so a bridge or scenario change that skips more
  shows up.

| Primitive  | Scenarios | Passed | Unsupported (bridge gate) | Divergences (still failing) | Walk configs |
| ---------- | --------- | ------ | ------------------------- | --------------------------- | ------------ |
| button     | 55        | 7      | 41                        | 7                           | 10           |
| switch     | 42        | 8      | 28                        | 6                           | 9            |
| checkbox   | 89        | 12     | 72                        | 5                           | 11           |
| disclosure | 65        | 31     | 26                        | 8                           | 7            |

The walk configs are eoa's: uncontrolled, controlled accepting, controlled holding, plus disabled, `enterToggles`, `mixed`.
**Divergences** are eoa's maps with their reasons, all carried over, none added, none dropped: each scenario still fails,
and the test requires it to (a closed gap forces removing the entry). They are about attributes and callbacks a library
test expects and this primitive does not provide (native `checked`/`disabled` attributes, ancestor `onClick`, an unmounted
closed panel, consumer attributes, hover state). None is a browser focus quirk. `disabledAttr` in each test says which
attribute spells `disabled` (aria-disabled for button, switch and checkbox; native `disabled` for the disclosure trigger),
because a neutral part has one flag and the probe has to read it the way eoa's did.

What differs from eoa's primitives: no `*Props` objects and no `onClick`/`onKeyDown` DOM handlers; the part has its own
`focused` and key handling for button and disclosure (the DOM got both from `<button>`); `checkbox` uses `boolean | "mixed"`
instead of `"true" | "false" | "mixed"`; ids come from a counter, not `createUniqueId`; the click-sets-focus workaround of
switch and checkbox is gone (the driver's `click` focuses first, as a pointer press does).

### Mutation check

Dropping the change callback of a controlled request (`if (options.value() === undefined) options.onChange()?.(…)` in
`controllable.ts`) fails 29 tests: 19 controlled walks across the four primitives, 6 controlled scenarios, the 3 pinned-count checks that
follow them and the unit test. Reverted. Dropping the blur-disarm of Space fails only the unit test in `controllable.test.ts`, **not the
walk**: the walk's `key` step is a whole press, so an armed Space never lingers. Making Enter always toggle a switch fails
the walk. Specs and bridges are eoa's, so that blind spot is eoa's too.

## Vendored

`vendor/` holds the spec side, copied read-only from effects-of-atmosphere at `8b72109`; see
[vendor/README.md](vendor/README.md). `effect@4.0.0` is the one dependency it needs.

## Left

- **Focus groups and roving focus** (toolbar, tabs, radio group, menus): `focus/` builds the focus manager; these
  primitives only take `focus()`/`blur()` and key events routed to them.
- Overlays (dialog, tooltip, menu button), text input and the caret, the rest of eoa's patterns (they port the same way:
  a bridge, a mount, a `conformance` call).
- The Solid → Clay renderer that consumes the parts (`solid/`), and an accessibility tree from them.
- Pointer arming (`pointer_down` … `pointer_cancel`) is not a primitive state: `press()` is the release. The spec models it,
  eoa's DOM primitive did not either, and its scenarios on it are `data-pressed` ones, skipped.
