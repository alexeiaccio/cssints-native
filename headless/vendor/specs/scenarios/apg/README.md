# APG scenarios — upstream tests ported as library-neutral data

One file per pattern and source: `<pattern>.<source>.json`, where `<source>` is
`ariakit`, `base-ui`, `react-aria` or `apg` (scenarios written by us from the APG
page). Each scenario is a port of one upstream test (no code copied; behaviour
restated) and is replayed against the Quint spec (`specs/apg/<pattern>*.qnt`) and
the Solid implementation by `src/scenario.ts`.

**This file is the one format spec (format v2).** The canvas scenarios
(`../canvas/README.md`) share the envelope and the `skipped` shape below but have
their own step/expectation vocabulary (pointer geometry, camera) and are not
decoded by `src/scenario.ts`; that README says so. `src/scenario.ts` is the
executable version of this document: every field named here is decoded and typed
there, and `test/apg/scenario-format.test.ts` checks every file in this
directory against it.

Pinned upstreams (shallow clones in the session temp dir `upstream/`):

| source     | repo                 | commit                                     | licence    |
| ---------- | -------------------- | ------------------------------------------ | ---------- |
| ariakit    | ariakit/ariakit      | `404c72257b879569feb08465da4ff9915fd873da` | MIT        |
| base-ui    | mui/base-ui          | `19511bb171f3b360b006c94cf6d07e53cb446505` | MIT        |
| react-aria | adobe/react-spectrum | `99e610236887da619ad9d54a1cd87983166c043d` | Apache-2.0 |

## Envelope

```jsonc
{
  "pattern": "tabs", // APG pattern slug (w3.org/WAI/ARIA/apg/patterns/<slug>/)
  "source": "react-aria",
  "commit": "99e6102…", // null for source "apg"
  "license": "Apache-2.0",
  "upstream": "https://…", // source "apg" only: the APG page
  "retrieved": "2026-10-03", // source "apg" only
  "fixture": {}, // optional, informational (shared fixture description); never passed to a driver
  "notes": "optional, file level",
  "skipped": [{ "upstream": "…", "upstreamTest": "…", "reason": "…" }],
  "scenarios": [
    {
      "id": "tabs.react-aria.arrow-right-moves-focus", // unique, kebab-case, `<pattern>.<source>.<slug>`
      "upstream": "https://github.com/adobe/react-spectrum/blob/<commit>/<path>#L<line>",
      "upstreamTest": "Tabs > should focus the next tab on ArrowRight",
      "apg": "keyboard", // APG section the behaviour comes from, or "extension" if not in APG
      "config": {
        "orientation": "horizontal",
        "activation": "automatic",
        "items": 3,
      },
      "steps": [
        { "event": "focus", "target": "tab:0" },
        { "event": "key", "key": "ArrowRight", "target": "tab:0" },
        {
          "expect": {
            "focus": "tab:1",
            "attrs": { "tab:1": { "aria-selected": "true" } },
          },
        },
      ],
      "notes": "optional: divergence from APG, platform-specific behaviour",
    },
  ],
}
```

`skipped` is always present (use `[]`) and always the **object form**
`{ upstream?, upstreamTest?, reason, id? }`: `reason` is required; `upstream` /
`upstreamTest` say which upstream test was not ported when there is one; `id` names
the would-be scenario for `apg`-source files. Bare strings are not allowed.

## Steps

A step is **either** an action (has `event`) **or** an expectation (has only
`expect`). Never both: a step carrying `event` and `expect` is read as an action
with an unknown field and the scenario becomes unsupported, so write the check as
the following step.

Action fields (all decoded and typed in `ActionStep`):

| field              | type                                    | meaning                                                                                                                       |
| ------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `event`            | string                                  | `focus` `blur` `click` `pointerdown` `pointermove` `pointerup` `hover` `unhover` `key` `type` `prop` `wait` …                 |
| `target`           | target (grammar below)                  | the part the event is delivered to; `key`/`type` first focuses it, as a user would (a `phase: "up"` key does not)             |
| `key`              | string                                  | `KeyboardEvent.key` (`Enter`, `ArrowDown`, `Tab`, `" "`; `Space` is accepted for `" "`)                                       |
| `text`             | string                                  | text typed by a `type` event                                                                                                  |
| `prop`             | string                                  | prop name for a `prop` event; with no `value` it is a trigger (`beforematch` fires the `beforematch` event on the target)     |
| `value`            | JSON                                    | the new value for `prop`, or the value an event carries                                                                       |
| `set`              | object                                  | `prop` event changing several props at once: `{ "event": "prop", "set": { "open": true } }`                                   |
| `repeat`           | `true` \| integer                       | `true`: this keydown is an auto-repeat (`KeyboardEvent.repeat`); `N`: the key is held for `N` repeat keydowns                 |
| `ms`               | number                                  | duration of a `wait` event (fake-timer milliseconds)                                                                          |
| `position`         | number 0..1                             | where on the target track a pointer event lands, as a fraction of its length                                                  |
| `modifiers`        | `Alt`\|`Control`\|`Meta`\|`Shift` array | held modifiers (a set; write them sorted). Never `shiftKey`, `ctrl`, `altKey`, …                                              |
| `phase`            | `down` \| `up`                          | which half of a `key` press (default: the full press); `down` holds the key for a later `up` step, so a blur can land between |
| `button`           | number                                  | `MouseEvent.button` (0 primary, 1 auxiliary, 2 secondary)                                                                     |
| `buttons`          | number                                  | `MouseEvent.buttons` bitmask                                                                                                  |
| `pointerType`      | `mouse` \| `pen` \| `touch`             | `PointerEvent.pointerType` (default `mouse`)                                                                                  |
| `pointerId`        | number                                  | `PointerEvent.pointerId`                                                                                                      |
| `detail`           | number                                  | `UIEvent.detail` of a click                                                                                                   |
| `count`            | number                                  | click count (`2` = double click)                                                                                              |
| `canceled`         | boolean                                 | the event is canceled (`preventDefault`) before the widget sees it                                                            |
| `defaultPrevented` | boolean                                 | the event is expected to end with its default prevented (`true`) or not (`false`)                                             |
| `isComposing`      | boolean                                 | `KeyboardEvent.isComposing`                                                                                                   |
| `inputEvent`       | string                                  | origin of a `type` event (`paste`, `programmatic`)                                                                            |

Any other field is **unknown**: it is preserved on decode and makes the scenario
`unsupported` (skipped, never silently replayed as a different step).

Typed is not the same as supported. The core fields (`event` `target` `key`
`text` `prop` `value` `repeat` `ms`) are understood by every bridge. The rest
(`EXTENDED_STEP_FIELDS` in `src/scenario.ts`) are decoded for everyone, but a
scenario using one is `unsupported` until the bridge lists it in
`SpecBridge.stepFields`, because a bridge that ignored `modifiers` would replay a
different step. A bridge that honours a field declares it; nothing else changes.

## Expectations

`{ "expect": { … } }` checks only what the upstream test checks:

| key       | type                                   | meaning                                                                                                                                               |
| --------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `focus`   | target \| `null`                       | the part holding focus (`null` = nothing in the widget)                                                                                               |
| `attrs`   | `{ target: { name: string \| null } }` | attribute (or reflected property) values as strings; `null` = absent; booleans are `"true"`/`"false"`                                                 |
| `visible` | target[]                               | exactly these parts are visible                                                                                                                       |
| `hidden`  | target[]                               | these parts are not visible (the others are unconstrained)                                                                                            |
| `value`   | JSON                                   | the pattern's observable value                                                                                                                        |
| `events`  | `{ callback: payload[] }`              | callbacks fired since mount, in order, one payload per call: `{ "onSelectionChange": ["tab:1"] }`; a sentinel is still a one-element list (`["all"]`) |
| `checked` | target \| `null`                       | the checked item of a single-selection group (radio)                                                                                                  |

The engine currently **checks** `focus`, `attrs`, `visible`, `value`, `events`.
`hidden` and `checked` are decoded and typed but reported as skipped
(`expectation not supported by the replay engine`) until the engine implements
them. Unknown expectation keys are preserved and reported the same way.

**Symbolic relationship refs.** For the IDREF attributes (`aria-controls`,
`aria-labelledby`, `aria-describedby`, `aria-activedescendant`, `aria-owns`,
`aria-details`, `aria-errormessage`, `aria-flowto`) an `attrs` value of the form
`<part>:<index>` (a whitespace-separated list is allowed) is a reference to that
part, not a literal id: `"aria-controls": "tabpanel:1"`,
`"aria-activedescendant": "option:0"`, `"aria-describedby": "description:0 error:0"`.
The driver resolves it to the part's real id. Anything that is not a target is a
literal id (`"aria-labelledby": "custom-trigger-id"`).

## Target grammar

```
target   = part [ ":" locator ] { "/" child }
part     = name                          tab  tabpanel  popup  nested-dialog
locator  = index                         tab:1   option:0
         | path                          row:0/1/2  treeitem:0/1  menuitem:1/0   (indices joined by "/")
         | path "," index                cell:<row>,<col>   cell:0/3,2  (row may be a path)
         | name                          checkbox:parent  button:disabled  input:hidden  (non-indexed variant)
child    = name [ ":" index ]            /checkbox  /chevron  /link  /child:0  (n-th child element of the part)
name     = [A-Za-z][A-Za-z0-9-]*
```

A segment after `/` that starts with a digit continues the path; one that starts
with a letter is a child. `tab` and `tab:0` name the same single part. Paths are
always written with their part prefix (`row:0/1`, never a bare `0/1`).

## Part names

`target` uses **scenario names**; the specs use their own. The table maps them
(the machine-readable source is [`../parts.json`](../parts.json), which the bridges
should read instead of hard-coding aliases; the `.qnt` files are not renamed).
`← spec x` means the spec calls the part `x`. Names in the last column are
page/fixture parts of the scenarios (the page around the widget, helper controls);
they may appear in targets but carry no spec meaning. `test/apg/scenario-format.test.ts`
fails when a scenario uses a name that is in neither column.

| pattern             | spec                                                                                                                     | parts (scenario name ← spec name)                                                                                                                                                                                                                      | fixture parts                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `accordion`         | `accordion.qnt`                                                                                                          | `trigger` ← spec `header`, `panel` ← spec `content`, `heading`                                                                                                                                                                                         | `menu`, `menuTrigger`                                          |
| `alert`             | `alert.qnt`                                                                                                              | `alert`, `close` ← spec `dismiss`                                                                                                                                                                                                                      | `add`, `add-high`, `content`, `region`, `root`, `toast`        |
| `alertdialog`       | `alertdialog.qnt`                                                                                                        | `trigger` ← spec `discard`, `dialog` ← spec `alertdialog`, `cancel` ← spec `no`, `confirm` ← spec `yes`                                                                                                                                                | `backdrop`, `dismiss`, `secondary`                             |
| `breadcrumb`        | `breadcrumb.qnt`                                                                                                         | `item`, `link`, `nav` (no spec name), `breadcrumb` (no spec name)                                                                                                                                                                                      | —                                                              |
| `button`            | `button.qnt`                                                                                                             | `button`, `group` (no spec name), `text` (no spec name)                                                                                                                                                                                                | —                                                              |
| `carousel`          | `carousel.qnt`                                                                                                           | `carousel` (no spec name), `rotation`, `prev`, `next`, `tab`, `slide`                                                                                                                                                                                  | —                                                              |
| `checkbox`          | `checkbox.qnt`, `checkbox-group.qnt`                                                                                     | `checkbox`, `group` (no spec name)                                                                                                                                                                                                                     | `button`, `input`, `label`                                     |
| `combobox`          | `combobox-autocomplete.qnt`, `combobox-dialog.qnt`, `combobox-grid.qnt`, `combobox-select-only.qnt`, `combobox-tree.qnt` | `input`, `trigger` ← spec `button`, `popup`, `option`, `gridcell` ← spec `cell`, `treeitem` ← spec `node`                                                                                                                                              | `body`, `final-focus-button`, `label`, `next-button`           |
| `dialog-modal`      | `dialog-modal.qnt`                                                                                                       | `trigger` ← spec `invoker`, `dialog`, `backdrop` (no spec name)                                                                                                                                                                                        | any kebab-case name                                            |
| `disclosure`        | `disclosure.qnt`                                                                                                         | `trigger`, `panel`, `heading` (no spec name)                                                                                                                                                                                                           | `disclosure`                                                   |
| `feed`              | `feed.qnt`                                                                                                               | `feed`, `article`, `before-feed` ← spec `before`, `after-feed` ← spec `after`                                                                                                                                                                          | —                                                              |
| `grid`              | `grid.qnt`, `grid-selection.qnt`, `grid-sort.qnt`                                                                        | `cell`, `row`, `rowgroup` (no spec name), `columnheader` ← spec `header`                                                                                                                                                                               | `after`, `body`, `checkbox`, `combobox`, `dialog`, `rowheader` |
| `landmarks`         | —                                                                                                                        | `main` (no spec name), `navigation` (no spec name), `region` (no spec name), `button` (no spec name), `link` (no spec name), `listitem` (no spec name)                                                                                                 | —                                                              |
| `link`              | `link.qnt`                                                                                                               | `link`, `button` (no spec name)                                                                                                                                                                                                                        | —                                                              |
| `listbox`           | `listbox-single.qnt`, `listbox-multi.qnt`, `listbox-typeahead.qnt`, `listbox-rearrangeable.qnt`                          | `listbox`, `option`                                                                                                                                                                                                                                    | `trigger`                                                      |
| `menu-button`       | `menu-button.qnt`, `menu-checkable.qnt`                                                                                  | `trigger` ← spec `button`, `menu`, `menuitem` ← spec `item`, `submenu` (no spec name)                                                                                                                                                                  | `after`, `body`, `dialog`, `dismiss`, `group`, `outside`       |
| `menubar`           | `menu-menubar.qnt`                                                                                                       | `menubar`, `menu`, `menuitem` ← spec `item`, `submenu`                                                                                                                                                                                                 | `body`, `outside`                                              |
| `meter`             | `meter.qnt`                                                                                                              | `meter`                                                                                                                                                                                                                                                | —                                                              |
| `radio`             | `radio.qnt`                                                                                                              | `radiogroup`, `radio`                                                                                                                                                                                                                                  | —                                                              |
| `slider`            | `slider.qnt`                                                                                                             | `thumb`, `track` ← spec `rail`                                                                                                                                                                                                                         | `body`                                                         |
| `slider-multithumb` | `slider-multithumb.qnt`                                                                                                  | `thumb`, `track` ← spec `rail`                                                                                                                                                                                                                         | `body`                                                         |
| `spinbutton`        | `spinbutton.qnt`                                                                                                         | `input`, `increment`, `decrement`                                                                                                                                                                                                                      | `description`, `error`, `group`, `label`                       |
| `switch`            | `switch.qnt`                                                                                                             | `switch`                                                                                                                                                                                                                                               | `button`, `input`, `label`                                     |
| `table`             | —                                                                                                                        | `table` (no spec name), `rowgroup` (no spec name), `row` (no spec name), `columnheader` (no spec name), `rowheader` (no spec name), `gridcell` (no spec name), `caption` (no spec name), `colindex-cell` (no spec name), `colspan-cell` (no spec name) | —                                                              |
| `tabs`              | `tabs.qnt`                                                                                                               | `tablist`, `tab`, `tabpanel`                                                                                                                                                                                                                           | `link`                                                         |
| `toolbar`           | `toolbar.qnt`                                                                                                            | `toolbar`, `item`                                                                                                                                                                                                                                      | `dialog`, `menuitem`, `option`, `popup`                        |
| `tooltip`           | `tooltip.qnt`                                                                                                            | `trigger`, `tooltip`                                                                                                                                                                                                                                   | —                                                              |
| `treegrid`          | `treegrid.qnt`                                                                                                           | `treegrid` ← spec `grid`, `row`, `cell`, `chevron` ← spec `expander`                                                                                                                                                                                   | `checkbox`, `document`, `info`, `link`, `menu`                 |
| `treeview`          | `treeview.qnt`                                                                                                           | `tree`, `treeitem` ← spec `node`                                                                                                                                                                                                                       | —                                                              |
| `windowsplitter`    | `windowsplitter.qnt`                                                                                                     | `separator` ← spec `splitter`, `primary`, `secondary`                                                                                                                                                                                                  | —                                                              |

Spec names are the names the `.qnt` header comments and action names use
(`click_header`, `click_button`, `focusSplitter`, …); where a spec encodes parts
as numbers (alertdialog/dialog-modal focus slots) the name is the role the
comment gives. `gridcell` and `treeitem` under `combobox` are reserved for the
grid/tree popups (no scenario uses them yet; the bridges already accept them).
`treegrid`'s `chevron` is a child part (`row:0/chevron`) that the spec calls
`expander`.

## Rules

- `target` uses APG part names (see the table). Rendering details, styling and
  React-only APIs are out of scope; list them under `skipped`.
- Do not invent a field: if a step needs something not listed here, add it to
  this file and to `ActionStep` in the same change.
- Units for `position` (fraction of the track) and `ms` (fake-timer time) are
  fixed; `button`/`buttons`/`pointerId`/`detail` are the DOM values.
- When a scenario's expectation and a primitive disagree, the
  [divergence policy](../../headless/README.md#divergence-policy) decides which
  wins; a deliberate miss stays a negative test in the primitive's `DIVERGENCES`
  map, and `notes` records why.
