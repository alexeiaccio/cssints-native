# focus

Which entry has focus, the Tab order, roving focus inside a group, and a stack to bring focus back. Plain TypeScript,
no DOM, no framework. The headless widgets call this where they used `document.activeElement` and `element.focus()`.

```ts
import { createFocus } from "./src/focus.ts";

const focus = createFocus();
focus.group("toolbar", { orientation: "horizontal", wrap: true, memory: true });
focus.register("bold", { group: "toolbar" });
focus.register("italic", { group: "toolbar" });
focus.register("save");

focus.key("Tab");        // "bold": one stop for the whole toolbar
focus.key("ArrowRight"); // "italic"
focus.key("Tab");        // "save": Tab leaves the group
```

## API

| | |
|---|---|
| `createFocus(): Focus` | a new focus state |
| `register(id, { order?, disabled?, tabIndex?, group? })` | add or replace an entry. Re-registering with `disabled` is how a widget disables an item |
| `unregister(id)` | remove an entry; if it was focused, focus moves on (see below) |
| `group(id, { orientation, wrap, memory, entry?, focusDisabled? })` | define a group before its members are registered |
| `focused(): string \| null` | the focused entry |
| `focus(id): boolean` | programmatic focus; `false` for an unknown or non-focusable (disabled) id |
| `blur()` | no entry focused |
| `key(name): boolean` | `Tab`, `Shift+Tab`, `ArrowLeft/Right/Up/Down`, `Home`, `End`. Returns whether the manager handled it |
| `tabOrder(): string[]` | the Tab stops in order: a plain entry's id, or the member a group's Tab lands on |
| `onChange(listener): () => void` | `listener(next, prev)`, once per real change of the focused entry. Returns unsubscribe |
| `push(id)` / `pop(): string \| null` | restore stack for dialogs: `push` the trigger when opening, `pop` when closing |

Entries: `order` is the document order (default: registration order), so pass it when registration order differs.
`tabIndex < 0` keeps an entry out of the Tab order and out of its group's arrows, but `focus(id)` still works (as
`tabindex="-1"` does in a DOM).

Groups: `orientation` says which arrows the group owns. `wrap` wraps the arrows at the ends. `memory` makes Tab back in
land on the member focused last. Without memory, Tab lands on `entry` (default: the first member). `focusDisabled`
lets disabled members stay focusable and reachable by the arrows.

## Semantics

- **One Tab stop per group.** A group is one stop, wherever its first member sits in the document order. Tab or
  Shift+Tab from any member leaves the group.
- **Tab** moves to the next stop, **Shift+Tab** to the previous one. From nothing, Tab starts at the first stop and
  Shift+Tab at the last. Past either end, focus is released (`focused()` is `null`) and `key` returns `false`, so the
  host lets the platform's own Tab take over.
- **Arrows** move within the focused entry's group. Horizontal owns Left/Right, vertical owns Up/Down, both owns all
  four and walks the members in order (no 2D grid). An arrow the group does not own returns `false` and changes nothing.
  An owned arrow returns `true` even at a nowrap edge, where nothing moves, so the host can still prevent the default.
- **Home / End** go to the first / last member of the focused entry's group, whatever the orientation. Outside a group
  they return `false`.
- **Disabled** entries are skipped by Tab and the arrows, and `focus(id)` refuses them, unless the group has
  `focusDisabled`. A focused entry that becomes disabled, or is unregistered, hands the focus on: to the nearest member
  of its group, else to the next stop, else to none.
- **Restore.** `pop()` focuses the most recent pushed id that is still focusable, and drops the stale ones on the way.
  It returns `null` and leaves focus alone when none is left.
- Keys are names only: the manager has no modifiers, so Alt/Ctrl/Shift+Arrow never reach it. The host sends only
  the plain key.

## APG rules followed

Specs in `~/github/effects-of-atmosphere/packages/specs/` (read, not run through Quint). The group contract is
`specs/shared/focusgroup.qnt`, which the toolbar spec imports.

- **focusgroup `fgLanding`, `fgEntry`, `fgEscape`:** one tab stop per group; arrows along the axis only, perpendicular
  arrows left to the author; Home/End jump to the first/last item; last-focused memory on re-entry; Tab leaves the group.
- **tabs.qnt:** Tab enters on the active tab and leaves the tablist; "arrows of the other axis are ignored"; wrap
  last→first; Home/End; disabled tabs are skipped.
- **toolbar.qnt:** a disabled item stays reachable (aria-disabled, `focusDisabled`) and is not activated; wrap is the
  author's choice (`wrap`).
- **radio.qnt:** Tab enters on the checked radio or the first one (`entry`), disabled radios are never focused and the
  arrows skip them, wrapping across them.

## Our choices (not in the specs)

- Tab past the last stop releases focus, as a browser does. The specs model a page, so they never see this.
- An owned arrow at a nowrap edge is still handled (see Semantics).
- Unregistering a focused group member moves focus to a sibling, not to the next stop, when the group has one left.
- `onChange` is the only effect. A radio that checks on arrow, or a tab that selects on focus, is the widget's job:
  it listens and selects.

## Left

- **RTL:** Left/Right are not swapped. The specs leave it out too.
- **Typeahead:** no letter keys; listbox-typeahead.qnt is a separate pattern.
- **Grids and 2D roving:** `both` is linear. treegrid.qnt and grid.qnt need row and column.
- **Native key conflicts:** the specs let Tab step past a text input's own keys. The platform's text input (SDL) has
  to tell the host when it takes a key, and the host decides what `key` gets. Nothing here knows about SDL.
- **Cost:** every `key`, `tabOrder` and relocation sorts the entries. Fine for a page of widgets; add an index when a
  list has thousands of entries.
