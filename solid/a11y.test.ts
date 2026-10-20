// The accessibility tree of the three pages: what a screen reader would walk, asserted from the same rendered Solid
// trees as `widgets.test.ts`, `field.test.ts` and `dialog.test.ts` (two frames, then the snapshot).
//
// The pages keep their parts private and spread only `id` and `focused` onto their boxes (`input.bind(part)`), so the
// tree itself carries no `role`, `checked`, `expanded`, ... today: each page's part fields are declared here as the
// props the page should spread (`<box {...part}>`), with its initial state. Everything else — the names, the nesting,
// the order, the bounds, the focus, the pruning — is read from the page's tree and from `ui.bounds`. `solid/README.md`
// and `docs/map.md` list what each page drops; the checks named "the gap" below are what a page has to fix.
import "./plugin.ts";

const { ui } = await import("./src/ffi.ts");
const { createFrame } = await import("./src/frame.ts");
const { createInput } = await import("./src/input.ts");
const { El, render, Txt } = await import("./src/renderer.ts");
import type { A11yNode, PartFields } from "./a11y.ts";

const { snapshot } = await import("./a11y.ts");
const { Widgets, size: widgetsSize, s: widgets } = await import("./app/Widgets.tsx");
const { Field, size: fieldSize } = await import("./app/Field.tsx");
const { Dialog, size: dialogSize } = await import("./app/Dialog.tsx");

ui.font(new URL("../vendor/fonts/Roboto-Regular.ttf", import.meta.url).pathname);

let failed = 0;
const check = (what: string, got: unknown, want: unknown) => {
  const [a, b] = [JSON.stringify(got), JSON.stringify(want)];
  if (a !== b) failed++, console.error(`FAIL ${what}: ${a}, wanted ${b}`);
};

const walk = (node: A11yNode): A11yNode[] => [node, ...node.children.flatMap(walk)];
const nodes = (node: A11yNode, pred: (n: A11yNode) => boolean): A11yNode[] => walk(node).filter(pred);
const one = (node: A11yNode, pred: (n: A11yNode) => boolean): A11yNode | undefined => walk(node).find(pred);
const byName = (node: A11yNode, name: string): A11yNode | undefined => one(node, (n) => n.name === name);
/** The indexes from `node` down to the one a predicate picks, as a path into the snapshot. */
const pathTo = (node: A11yNode, pred: (n: A11yNode) => boolean): number[] | undefined => {
  if (pred(node)) return [];
  for (let i = 0; i < node.children.length; i++) {
    const path = pathTo(node.children[i]!, pred);
    if (path) return [i, ...path];
  }
  return undefined;
};
const box = (id: string) => [...ui.bounds(Buffer.from(id))!];

// One page as the window runs it: render, two frames (bounds need one), then step() per input.
function page(size: { width: number; height: number }, make: (input: ReturnType<typeof createInput>) => unknown) {
  ui.init(size.width, size.height);
  const root = new El("root");
  const input = createInput();
  const unhandled: string[] = [];
  input.fallback = (name) => (unhandled.push(name), false);
  const dispose = render(() => make(input), root);
  const frame = createFrame(root, { onPressMiss: () => input.pressMiss() });
  const step = () => frame(-1, -1, false, 1 / 60);
  step(), step();
  return {
    root,
    input,
    unhandled,
    dispose,
    step,
    snap: (options: Parameters<typeof snapshot>[1]) => snapshot(root, options),
    /** a whole key press with a frame after it */
    tap(name: string) {
      input.down(name);
      input.up(name);
      step();
    },
    /** the elements the page drew with this style: what its state looks like */
    styled(style: object): number {
      const find = (el: El): number =>
        el.children.reduce((n: number, c) => n + (c instanceof El ? (c.props.style === style ? 1 : 0) + find(c) : 0), 0);
      return find(root);
    },
  };
}

// --- the Widgets page: the part fields the page should spread, and the group parts whose boxes it drops
// (`speed.group`, `tabs.tablist`, `format.toolbar`, `settings.tree` and `size.menu` have no `id` on a box: the page
// renders their items only). The snapshot adopts a dropped container at the box that holds its items.
const WIDGET_PARTS: PartFields[] = [
  { id: "press", role: "button" },
  { id: "wifi", role: "switch", checked: false },
  { id: "all", role: "checkbox", checked: false },
  { id: "wired", role: "checkbox", checked: false },
  { id: "wireless", role: "checkbox", checked: false },
  { id: "beta", role: "checkbox", checked: false, disabled: true },
  { id: "more-trigger", role: "button", expanded: false },
  { id: "speed-radio-0", role: "radio", checked: true },
  { id: "speed-radio-1", role: "radio", checked: false },
  { id: "speed-radio-2", role: "radio", checked: false },
  { id: "tabs-tab-0", role: "tab", selected: true },
  { id: "tabs-tab-1", role: "tab", selected: false },
  { id: "tabs-tab-2", role: "tab", selected: false },
  { id: "tabs-tabpanel-0", role: "tabpanel", labelledBy: "tabs-tab-0" },
  { id: "volume-thumb", role: "slider", valueText: "40%" },
  // format-item-2's `expanded` and `hasPopup` are the page's own props (it passes them, the part's fields still go
  // unread): the snapshot takes the box's prop over the table's.
  { id: "format-item-0", role: "button" },
  { id: "format-item-1", role: "button" },
  { id: "format-item-2", role: "button" },
  { id: "settings-item-1", role: "treeitem", level: 1, expanded: true },
  { id: "settings-item-2", role: "treeitem", level: 2 },
  { id: "settings-item-3", role: "treeitem", level: 2 },
  { id: "settings-item-4", role: "treeitem", level: 1, expanded: false },
  { id: "settings-item-5", role: "treeitem", level: 2 },
  { id: "settings-item-6", role: "treeitem", level: 1 },
];
const WIDGET_GROUPS = [
  { part: { id: "speed", role: "radiogroup" }, items: ["speed-radio-0", "speed-radio-1", "speed-radio-2"] },
  { part: { id: "tabs-tablist", role: "tablist" }, items: ["tabs-tab-0", "tabs-tab-1", "tabs-tab-2"] },
  { part: { id: "format", role: "toolbar" }, items: ["format-item-0", "format-item-1", "format-item-2"] },
  {
    part: { id: "settings", role: "tree" },
    items: ["settings-item-1", "settings-item-2", "settings-item-3", "settings-item-4", "settings-item-5", "settings-item-6"],
  },
];
const widgetsParts = (over: Record<string, Partial<PartFields>> = {}): PartFields[] =>
  WIDGET_PARTS.map((part) => ({ ...part, ...over[part.id] }));

{
  const p = page(widgetsSize, (input) => Widgets({ input }));
  const snap = p.snap({ parts: WIDGET_PARTS, containers: WIDGET_GROUPS });
  check("widgets: the roles, in document order, with the groups' items nested", snap.children.map((n) => n.role), [
    "button",
    "switch",
    "checkbox",
    "checkbox",
    "checkbox",
    "checkbox",
    "button",
    "radiogroup",
    "tablist",
    "tabpanel",
    "slider",
    "toolbar",
    "tree",
  ]);
  check("widgets: names from the text, the mixed and the disabled checkbox, the disclosure's state",
    snap.children.slice(0, 7).map((n) => [n.name, n.states.checked ?? null, n.states.disabled ?? false]),
    [["Presses: 0", null, false], ["Wi-Fi", false, false], ["Select all", false, false], ["Wired", false, false],
     ["Wireless", false, false], ["Beta (disabled)", false, true], ["+Details", null, false]]);
  check("widgets: the disclosure trigger's expanded and the button's role", [
    snap.children[6]!.role, snap.children[6]!.states.expanded], ["button", false]);
  check("widgets: the buttons — the command button, the disclosure trigger and the toolbar's three",
    nodes(snap, (n) => n.role === "button").map((n) => n.name),
    ["Presses: 0", "+Details", "Bold", "Italic", "Size: Medium"]);

  const group = snap.children[7]!;
  check("widgets: the radiogroup's name is its caption's text, its radios' names are their own",
    [group.name, group.children.map((n) => [n.role, n.name, n.states.checked])],
    ["Speed", [["radio", "1x", true], ["radio", "4x", false], ["radio", "16x", false]]]);
  check("widgets: one radio is checked", nodes(snap, (n) => n.role === "radio" && n.states.checked === true).length, 1);

  const tablist = snap.children[8]!;
  check("widgets: the tablist with its three tabs, one selected",
    [tablist.name ?? null, tablist.children.map((n) => [n.role, n.name, n.states.selected])],
    [null, [["tab", "Overview", true], ["tab", "Stats", false], ["tab", "Log", false]]]);
  const panel = snap.children[9]!;
  check("widgets: the tabpanel's name comes from labelledBy (its own text is the two lines)",
    [panel.role, panel.name], ["tabpanel", "Overview"]);
  check("widgets: the panel's text is not a name of its own",
    one(snap, (n) => n.name?.startsWith("Three tabs")), undefined);

  const slider = snap.children[10]!;
  check("widgets: the slider's value is its valueText and its name falls back to the readout",
    [slider.role, slider.value, slider.name], ["slider", "40%", "40%"]);

  const toolbar = snap.children[11]!;
  check("widgets: the toolbar's three items, the menu button with hasPopup",
    toolbar.children.map((n) => [n.role, n.name, n.hasPopup ?? null, n.states.expanded ?? null]),
    [["button", "Bold", null, null], ["button", "Italic", null, null], ["button", "Size: Medium", "menu", false]]);

  const tree = snap.children[12]!;
  check("widgets: the tree's visible treeitems, level and expanded (- is open, + closed); the closed node is absent",
    tree.children.map((n) => [n.role, n.name, n.level, n.states.expanded ?? null]),
    [["treeitem", "-Network", 1, true], ["treeitem", "Wi-Fi", 2, null], ["treeitem", "Bluetooth", 2, null],
     ["treeitem", "+Display", 1, false], ["treeitem", "Storage", 1, null]]);
  check("widgets: the disabled checkbox is present and disabled, the tree selects nothing at rest",
    [one(snap, (n) => n.name === "Beta (disabled)")!.states.disabled, nodes(snap, (n) => n.states.selected === true).length],
    [true, 1]);
  check("widgets: no text node anywhere, and no node without a role",
    nodes(snap, (n) => !n.role || n.role === "text").length, 0);

  // bounds: the node's box in the layout of the last frame
  check("widgets: the command button's bounds are ui.bounds('press')", byName(snap, "Presses: 0")!.bounds, box("press"));
  check("widgets: the tree's row's bounds are ui.bounds('settings-item-1')",
    byName(snap, "-Network")!.bounds, box("settings-item-1"));
  check("widgets: an adopted container has no id to ask, so no bounds", group.bounds, undefined);

  // the gap, today: the page spreads `input.bind(part)` only, so the bare tree has no roles at all; the snapshot is
  // empty until a page spreads its part's fields. Remove this check when it does.
  const bare = p.snap();
  check("widgets: the gap — the page's boxes carry no role, so the bare snapshot has nothing but its document",
    [bare.role, bare.children.length], ["document", 0]);
  check("widgets: the gap — the disclosure's mark is part of its name ('+Details'): the page should hide the mark or label the trigger",
    byName(snap, "+Details") !== undefined, true);
  p.dispose();
}

// --- focus: Tab to the switch, and exactly that node says focused
{
  const p = page(widgetsSize, (input) => Widgets({ input }));
  p.tap("Tab");
  p.tap("Tab");
  check("focus: Tab twice reaches the switch", p.input.focus.focused(), "wifi");
  const snap = p.snap({ parts: WIDGET_PARTS, containers: WIDGET_GROUPS });
  check("focus: exactly one node is focused, by its path", pathTo(snap, (n) => n.states.focused === true), [1]);
  const focused = walk(snap).filter((n) => n.states.focused === true);
  check("focus: it is the switch, and its bounds are the focused part's", [focused.length, focused[0]!.role, focused[0]!.name],
    [1, "switch", "Wi-Fi"]);
  check("focus: the focused node's bounds are ui.bounds(input.focus.focused())", focused[0]!.bounds,
    [...ui.bounds(Buffer.from(p.input.focus.focused()!))!]);
  p.dispose();
}

// --- states the page changes: one child checked makes "Select all" mixed
{
  const p = page(widgetsSize, (input) => Widgets({ input }));
  for (let n = 0; n < 4; n++) p.tap("Tab");
  p.tap(" ");
  check("mixed: the page draws the dash of the mixed box", p.styled(widgets.dash), 1);
  const snap = p.snap({ parts: widgetsParts({ all: { checked: "mixed" }, wired: { checked: true } }), containers: WIDGET_GROUPS });
  check("mixed: Select all is mixed and Wired is checked", ["Select all", "Wired"].map((name) => byName(snap, name)!.states.checked),
    ["mixed", true]);
  p.dispose();
}

// --- a text-only container and a disclosure that opens: no node for the text, the name gets the mark
{
  const p = page(widgetsSize, (input) => Widgets({ input }));
  p.tap("Tab"), p.tap("Tab"), p.tap("Tab"), p.tap("Tab"), p.tap("Tab"), p.tap("Tab");
  p.tap("Enter");
  const snap = p.snap({ parts: widgetsParts({ "more-trigger": { expanded: true } }), containers: WIDGET_GROUPS });
  check("disclosure: the trigger's name and state follow the page", [byName(snap, "-Details")?.states.expanded], [true]);
  check("disclosure: the panel's sentence starts no node (it is a text-only box with no role)",
    one(snap, (n) => n.name?.startsWith("This panel is the disclosure's")), undefined);
  check("disclosure: the page-level roles are unchanged by the open panel",
    snap.children.map((n) => n.role), ["button", "switch", "checkbox", "checkbox", "checkbox", "checkbox", "button",
      "radiogroup", "tablist", "tabpanel", "slider", "toolbar", "tree"]);
  p.dispose();
}

// --- the Text field page
const FIELD_PARTS = (value = ""): PartFields[] => [
  { id: "press", role: "button" },
  { id: "name", role: "textbox", value },
  { id: "mail", role: "textbox", value: "ada@example.com" },
  { id: "submit", role: "button" },
];
{
  const p = page(fieldSize, (input) => Field({ input }));
  const snap = p.snap({ parts: FIELD_PARTS() });
  check("field: a textbox per field, the buttons, and no node for the page's own labels and notes",
    snap.children.map((n) => [n.role, n.name ?? null, n.value ?? null]),
    [["button", "Presses: 0", null], ["textbox", null, ""], ["textbox", "ada@example.com", "ada@example.com"],
     ["button", "Submit", null]]);
  check("field: the gap — the textbox's name is not the 'Name' label: TextFieldPart has no label, and the label's text has no id",
    byName(snap, "Name"), undefined);

  p.tap("Tab"), p.tap("Tab");
  check("field: Tab twice reaches the name field", p.input.focus.focused(), "name");
  p.input.textInput("Ada");
  p.step();
  const typed = p.snap({ parts: FIELD_PARTS("Ada") });
  const name = one(typed, (n) => n.role === "textbox" && n.value === "Ada")!;
  check("field: the value is the typed text, the name falls back to it (the label is still not associated)",
    [name.value, name.name, name.states.focused], ["Ada", "Ada", true]);
  p.dispose();
}

// --- the Dialog page: closed has no dialog; open is the dialog alone, the page behind pruned as a screen reader sees it
const DIALOG_PARTS: PartFields[] = [
  { id: "settings-trigger", role: "button" },
  { id: "zoom-trigger", role: "button" },
  { id: "settings-dialog", role: "dialog" },
  { id: "cancel", role: "button" },
  { id: "ok", role: "button" },
];
{
  const p = page(dialogSize, (input) => Dialog({ input }));
  const closed = p.snap({ parts: DIALOG_PARTS });
  check("dialog: closed, the page's two buttons and no dialog node", [
    nodes(closed, (n) => n.role === "dialog").length, closed.children.map((n) => [n.role, n.name]),
  ], [0, [["button", "Open settings"], ["button", "Zoom100%+"]]]);
  check("dialog: the gap — the menu trigger's name is 'Zoom' + its value + the mark, and no hasPopup/expanded: the page drops the trigger's fields",
    [byName(closed, "Zoom100%+")!.hasPopup, byName(closed, "Zoom100%+")!.states.expanded], [undefined, undefined]);

  p.tap("Tab");
  p.tap("Enter");
  const open = p.snap({ parts: DIALOG_PARTS });
  check("dialog: the backdrop creates no node (3 nodes closed, 4 open: the backdrop and the page's text are not nodes)",
    [walk(closed).length, walk(open).length], [3, 4]);
  check("dialog: open, the document is the modal dialog alone", open.children.map((n) => n.role), ["dialog"]);
  check("dialog: its name is its whole content (the page passes no labelledby), its two buttons inside",
    [open.children[0]!.name, open.children[0]!.children.map((n) => [n.role, n.name])],
    ["Set the volumeOK sets it to 55%. Cancel or Escape leaves it at 40%.", [["button", "Cancel"], ["button", "OK"]]]);
  check("dialog: the page behind is pruned, the dialog's buttons are not", [
    one(open, (n) => n.name === "Open settings"), one(open, (n) => n.name === "Cancel") !== undefined,
  ], [undefined, true]);
  p.dispose();
}

// --- the rules a page has not exercised yet, on a hand-built tree: nesting, labels, labelledBy, hidden pruning, no
// bounds without an id
{
  const el = (props: Record<string, unknown>, ...children: (El | Txt)[]): El => {
    const node = new El("box");
    Object.assign(node.props, props);
    for (const child of children) node.children.push(child), (child.parent = node);
    return node;
  };
  const text = (value: string) => new Txt(value);
  const root = new El("root");
  const add = (...children: El[]) => {
    for (const child of children) root.children.push(child), (child.parent = root);
  };
  add(
    el({ id: "label-1" }, text("A fixture")),
    // a role container whose only content is text is a node of its own
    el({ role: "group" }, text("Only text")),
    // role nodes nest, and a name from labelledBy wins over the element's own contents
    el({ role: "group", label: "Grouped" },
      el({ role: "button", id: "b1" }, text("Press me")),
      el({ role: "group", labelledBy: "label-1" }, el({ role: "button" }, text("Inner"))),
      el({ role: "region" }, el({ role: "link" }, text("A link"))),
    ),
    // hidden prunes the node and everything under it
    el({ role: "group", hidden: true }, el({ role: "button" }, text("Gone"))),
    el({ hidden: true, role: "button" }, text("Also gone")),
  );
  const snap = snapshot(root);
  check("rules: the roles in document order, the hidden subtrees pruned, the nested roles nested",
    walk(snap).map((n) => [n.role, n.name ?? null]),
    [["document", null], ["group", "Only text"], ["group", "Grouped"], ["button", "Press me"],
     ["group", "A fixture"], ["button", "Inner"], ["region", null], ["link", "A link"]]);
  check("rules: no id in the layout, so no bounds", one(snap, (n) => n.name === "Press me")!.bounds, undefined);
  check("rules: every node has a role and no text node is made", nodes(snap, (n) => !n.role || n.role === "text").length, 0);
}

if (failed) process.exit(1);
console.log(
  "solid/a11y.test.ts: the snapshot of the Widgets, Field and Dialog pages — roles, names, states, bounds, focus, pruning",
);
process.exit(0);
