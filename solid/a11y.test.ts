// The accessibility tree of the three pages: what a screen reader would walk, asserted from the same rendered Solid
// trees as `widgets.test.ts`, `field.test.ts` and `dialog.test.ts` (two frames, then the snapshot).
//
// Every page spreads each part onto the box that draws it (`{...bind(part)} {...a11y(part)}`, `solid/a11y.ts`), so the
// snapshot below is the bare page: no `parts` table stands in for what a page forgot, and a field a page drops shows up
// here as a missing role, name or state. Everything else — the names, the nesting, the order, the bounds, the focus, the
// pruning — is read from the page's tree and from `ui.bounds`.
import "./plugin.ts";

const { ui } = await import("./src/ffi.ts");
const { createFrame } = await import("./src/frame.ts");
const { createInput } = await import("./src/input.ts");
const { El, render, Txt } = await import("./src/renderer.ts");
import type { A11yNode } from "./a11y.ts";

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

/** The roles ARIA requires an accessible name of, among the ones these pages have: a node of one without a name is a gap. */
const NAMED = new Set([
  "button",
  "switch",
  "checkbox",
  "radio",
  "tab",
  "tabpanel",
  "slider",
  "textbox",
  "treeitem",
  "menuitem",
  "menuitemradio",
  "menuitemcheckbox",
  "dialog",
  "radiogroup",
  "menu",
]);
/** The two rules every page's snapshot is held to: a role on every node, a name on every role that must have one. */
function accessible(what: string, snap: A11yNode) {
  check(`${what}: no node without a role, and no text node`, nodes(snap, (n) => !n.role || n.role === "text").length, 0);
  check(`${what}: every role that requires a name has a non-empty one`,
    nodes(snap, (n) => NAMED.has(n.role) && (n.name === undefined || n.name.trim() === "")).map((n) => n.role), []);
}

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
    /** the bare page: every role, name and state is on the page's own boxes */
    snap: () => snapshot(root),
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

// --- the Widgets page. No table of parts: the page spreads each part itself, so these are its own boxes' roles
{
  const p = page(widgetsSize, (input) => Widgets({ input }));
  const snap = p.snap();
  check("widgets: the roles, in document order, the checkboxes and the groups' items nested", snap.children.map((n) => n.role), [
    "button",
    "switch",
    "group",
    "button",
    "radiogroup",
    "tablist",
    "tabpanel",
    "slider",
    "toolbar",
    "tree",
  ]);
  check("widgets: the group of the checkbox tree holds its four boxes, unnamed (the page has no caption for it)",
    [snap.children[2]!.name ?? null, snap.children[2]!.children.map((n) => n.role)], [null, ["checkbox", "checkbox", "checkbox", "checkbox"]]);
  check("widgets: names from the text, the mixed and the disabled checkbox, the disclosure's state",
    [snap.children[0]!, ...snap.children[2]!.children, snap.children[3]!].map((n) => [n.name, n.states.checked ?? null, n.states.disabled ?? false]),
    [["Presses: 0", null, false], ["Select all", false, false], ["Wired", false, false], ["Wireless", false, false],
     ["Beta (disabled)", false, true], ["Details", null, false]]);
  check("widgets: the disclosure trigger is a button, closed at rest", [snap.children[3]!.role, snap.children[3]!.states.expanded],
    ["button", false]);
  check("widgets: the disclosure's name is its own label, with no mark in it (the +/- stays a drawing)",
    [snap.children[3]!.name, one(snap, (n) => n.name === "+Details" || n.name === "-Details")], ["Details", undefined]);
  check("widgets: the buttons — the command button, the disclosure trigger and the toolbar's three",
    nodes(snap, (n) => n.role === "button").map((n) => n.name),
    ["Presses: 0", "Details", "Bold", "Italic", "Size: Medium"]);

  const group = snap.children[4]!;
  check("widgets: the radiogroup's name is its caption's (labelledBy), its radios' names are their own",
    [group.name, group.children.map((n) => [n.role, n.name, n.states.checked])],
    ["Speed", [["radio", "1x", true], ["radio", "4x", false], ["radio", "16x", false]]]);
  check("widgets: one radio is checked", nodes(snap, (n) => n.role === "radio" && n.states.checked === true).length, 1);

  const tablist = snap.children[5]!;
  check("widgets: the tablist with its three tabs, one selected",
    [tablist.name ?? null, tablist.children.map((n) => [n.role, n.name, n.states.selected])],
    [null, [["tab", "Overview", true], ["tab", "Stats", false], ["tab", "Log", false]]]);
  const panel = snap.children[6]!;
  check("widgets: the tabpanel's name comes from labelledBy (its own text is the two lines)",
    [panel.role, panel.name], ["tabpanel", "Overview"]);
  check("widgets: the panel's text is not a name of its own",
    one(snap, (n) => n.name?.startsWith("Three tabs")), undefined);

  const slider = snap.children[7]!;
  check("widgets: the slider is named by its caption and its value is its valueText (the readout is no name)",
    [slider.role, slider.name, slider.value], ["slider", "Volume", "40%"]);

  const toolbar = snap.children[8]!;
  check("widgets: the toolbar's three items, the menu button named by its item's label, with hasPopup",
    toolbar.children.map((n) => [n.role, n.name, n.hasPopup ?? null, n.states.expanded ?? null]),
    [["button", "Bold", null, null], ["button", "Italic", null, null], ["button", "Size: Medium", "menu", false]]);

  const tree = snap.children[9]!;
  check("widgets: the tree's visible treeitems, named by their node, level and expanded (- is open, + closed); the closed node is absent",
    tree.children.map((n) => [n.role, n.name, n.level, n.states.expanded ?? null]),
    [["treeitem", "Network", 1, true], ["treeitem", "Wi-Fi", 2, null], ["treeitem", "Bluetooth", 2, null],
     ["treeitem", "Display", 1, false], ["treeitem", "Storage", 1, null]]);
  check("widgets: the tree's nodes are named without their marks ('-Network' and '+Display' are no names)",
    nodes(snap, (n) => /^[-+](Network|Display|Wi-Fi|Bluetooth|Storage)$/.test(n.name ?? "")).map((n) => n.name), []);
  check("widgets: the disabled checkbox is present and disabled, the tree selects nothing at rest",
    [one(snap, (n) => n.name === "Beta (disabled)")!.states.disabled, nodes(snap, (n) => n.states.selected === true).map((n) => n.role)],
    [true, ["tab"]]);
  accessible("widgets", snap);

  // bounds: the node's box in the layout of the last frame; a container the page draws has one too
  check("widgets: the command button's bounds are ui.bounds('press')", byName(snap, "Presses: 0")!.bounds, box("press"));
  check("widgets: the tree's row's bounds are ui.bounds('settings-item-1')",
    byName(snap, "Network")!.bounds, box("settings-item-1"));
  check("widgets: the group containers are boxes of the page, so they have bounds",
    [group.bounds, tablist.bounds, toolbar.bounds, tree.bounds],
    [box("speed"), box("tabs-tablist"), box("format"), box("settings")]);
  p.dispose();
}

// --- focus: Tab to the switch, and exactly that node says focused; the disabled box is no stop
{
  const p = page(widgetsSize, (input) => Widgets({ input }));
  p.tap("Tab");
  p.tap("Tab");
  check("focus: Tab twice reaches the switch", p.input.focus.focused(), "wifi");
  const snap = p.snap();
  check("focus: exactly one node is focused, by its path", pathTo(snap, (n) => n.states.focused === true), [1]);
  const focused = walk(snap).filter((n) => n.states.focused === true);
  check("focus: it is the switch, and its bounds are the focused part's", [focused.length, focused[0]!.role, focused[0]!.name],
    [1, "switch", "Wi-Fi"]);
  check("focus: the focused node's bounds are ui.bounds(input.focus.focused())", focused[0]!.bounds,
    [...ui.bounds(Buffer.from(p.input.focus.focused()!))!]);
  p.dispose();
}
{
  const p = page(widgetsSize, (input) => Widgets({ input }));
  const stops: (string | null)[] = [];
  for (let n = 0; n < 6; n++) p.tap("Tab"), stops.push(p.input.focus.focused());
  check("focus: the disabled checkbox is no Tab stop — the sixth Tab is the disclosure, not Beta",
    [stops, nodes(p.snap(), (n) => n.states.disabled === true).map((n) => n.name)], [["press", "wifi", "all", "wired", "wireless", "more-trigger"], ["Beta (disabled)"]]);
  p.dispose();
}

// --- states the page changes: one child checked makes "Select all" mixed
{
  const p = page(widgetsSize, (input) => Widgets({ input }));
  for (let n = 0; n < 4; n++) p.tap("Tab");
  p.tap(" ");
  check("mixed: the page draws the dash of the mixed box", p.styled(widgets.dash), 1);
  const snap = p.snap();
  check("mixed: Select all reports 'mixed' and Wired is checked, off the page's own boxes",
    ["Select all", "Wired"].map((name) => byName(snap, name)!.states.checked), ["mixed", true]);
  p.dispose();
}

// --- a text-only container and a disclosure that opens: no node for the text, the name stays its label
{
  const p = page(widgetsSize, (input) => Widgets({ input }));
  for (let n = 0; n < 6; n++) p.tap("Tab");
  p.tap("Enter");
  const snap = p.snap();
  check("disclosure: the trigger keeps its name and opens", [byName(snap, "Details")?.states.expanded], [true]);
  check("disclosure: the panel's sentence starts no node (it is a text-only box with no role)",
    one(snap, (n) => n.name?.startsWith("This panel is the disclosure's")), undefined);
  check("disclosure: the page-level roles are unchanged by the open panel",
    snap.children.map((n) => n.role), ["button", "switch", "group", "button", "radiogroup", "tablist", "tabpanel", "slider",
      "toolbar", "tree"]);
  p.dispose();
}

// --- the settings tree holds the focus: the treeitem says focused, not the tree that contains it
{
  const p = page(widgetsSize, (input) => Widgets({ input }));
  for (let n = 0; n < 12; n++) p.tap("Tab");
  const focused = nodes(p.snap(), (n) => n.states.focused === true);
  check("tree focus: exactly one node is focused, the roving treeitem", focused.map((n) => [n.role, n.name]),
    [["treeitem", "Network"]]);
  p.dispose();
}

// --- the toolbar's menu: a menu node under the toolbar item, its radio items named and checked
{
  const p = page(widgetsSize, (input) => Widgets({ input }));
  for (let n = 0; n < 11; n++) p.tap("Tab");
  p.tap("ArrowRight"), p.tap("ArrowRight"), p.tap("ArrowDown");
  const snap = p.snap();
  const toolbar = snap.children[8]!;
  check("menu button: the third item is a button with hasPopup menu, open",
    [byName(snap, "Size: Medium")?.role, byName(snap, "Size: Medium")?.hasPopup, byName(snap, "Size: Medium")?.states.expanded],
    ["button", "menu", true]);
  const menu = toolbar.children.find((n) => n.role === "menu")!;
  check("menu: the menu is a node of the toolbar, named, its items radio menuitems with the picked one checked",
    [menu.name, menu.children.map((n) => [n.role, n.name, n.states.checked])],
    ["Size", [["menuitemradio", "Small", false], ["menuitemradio", "Medium", true], ["menuitemradio", "Large", false]]]);
  accessible("widgets menu", snap);
  p.dispose();
}

// --- the Text field page
{
  const p = page(fieldSize, (input) => Field({ input }));
  const snap = p.snap();
  check("field: a textbox per field, the buttons, and no node for the page's own notes",
    snap.children.map((n) => [n.role, n.name ?? null, n.value ?? null]),
    [["button", "Presses: 0", null], ["textbox", "Name", ""], ["textbox", "Read-only", "ada@example.com"],
     ["button", "Submit", null]]);
  check("field: the textbox's name is its visible label, through labelledBy",
    [snap.children[1]!.name, snap.children[2]!.name], ["Name", "Read-only"]);
  accessible("field", snap);

  p.tap("Tab"), p.tap("Tab");
  check("field: Tab twice reaches the name field", p.input.focus.focused(), "name");
  p.input.textInput("Ada");
  p.step();
  const typed = p.snap();
  const name = one(typed, (n) => n.role === "textbox" && n.value === "Ada")!;
  check("field: the value is the typed text, the name stays the label, the field is focused",
    [name.value, name.name, name.states.focused], ["Ada", "Name", true]);
  p.dispose();
}

// --- the Dialog page: closed has no dialog; open is the dialog alone, the page behind pruned as a screen reader sees it
{
  const p = page(dialogSize, (input) => Dialog({ input }));
  const closed = p.snap();
  check("dialog: closed, the page's two buttons and no dialog node", [
    nodes(closed, (n) => n.role === "dialog").length, closed.children.map((n) => [n.role, n.name]),
  ], [0, [["button", "Open settings"], ["button", "Zoom: 100%"]]]);
  check("dialog: the zoom trigger is named by its label, and carries hasPopup menu and expanded",
    [byName(closed, "Zoom: 100%")!.hasPopup, byName(closed, "Zoom: 100%")!.states.expanded], ["menu", false]);
  check("dialog: the trigger's mark and its value are no part of its name",
    [one(closed, (n) => n.name === "Zoom100%+"), byName(closed, "Open settings")!.hasPopup], [undefined, "dialog"]);
  accessible("dialog closed", closed);

  p.tap("Tab");
  p.tap("Enter");
  const open = p.snap();
  check("dialog: the backdrop creates no node (3 nodes closed, 4 open: the backdrop and the page's text are not nodes)",
    [walk(closed).length, walk(open).length], [3, 4]);
  check("dialog: open, the document is the modal dialog alone", open.children.map((n) => n.role), ["dialog"]);
  check("dialog: the dialog is named by its title (labelledBy), its two buttons inside",
    [open.children[0]!.name, open.children[0]!.children.map((n) => [n.role, n.name])],
    ["Set the volume", [["button", "Cancel"], ["button", "OK"]]]);
  check("dialog: the page behind is pruned, the dialog's buttons are not", [
    one(open, (n) => n.name === "Open settings"), one(open, (n) => n.name === "Cancel") !== undefined,
  ], [undefined, true]);
  accessible("dialog open", open);
  p.dispose();
}
// --- the Dialog page's menu, open: a menu node named by its trigger, its four items named
{
  const p = page(dialogSize, (input) => Dialog({ input }));
  p.tap("Tab"), p.tap("Tab"), p.tap("Enter");
  const snap = p.snap();
  const menu = one(snap, (n) => n.role === "menu")!;
  check("dialog menu: the menu is a node under its trigger, its four radio items named",
    [menu.name, menu.children.map((n) => [n.role, n.name])],
    ["Zoom", [["menuitem", "100%"], ["menuitem", "125%"], ["menuitem", "150%"], ["menuitem", "200%"]]]);
  check("dialog menu: the trigger reports it open", byName(snap, "Zoom: 100%")!.states.expanded, true);
  accessible("dialog menu", snap);
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
