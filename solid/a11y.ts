// The accessibility tree of a rendered page: what a screen reader would walk, taken from the same Solid tree the
// renderer declares to Clay, in document order, with the bounds Clay laid out last frame (the previous frame's, as a
// press reads them). A node is a `box` that carries a part's `role`; the title-of-this-file rules are:
//
// - role, name and states come from the box's own props first (`role`, `label`, `labelledBy`, `checked`, `expanded`,
//   `selected`, `disabled`, `focused`, `hidden`, `level`, `value`/`valueText`, `hasPopup`, `modal`), then from the part
//   the caller hands in with `options.parts` by id. The props win, so a page that spreads its parts needs no options.
// - `hidden` prunes the box and its subtree (a collapsed menu panel, a node in a closed subtree).
// - the name is `label`, else `labelledBy` resolved to the text of the element with that id (when it is in the tree),
//   else the text of its descendants that is not inside a nested role node, trimmed.
// - a `text` element is never a node: its text goes into the enclosing node's name.
// - `bounds` is `ui.bounds(id)` as [x, y, w, h], for a box with an id only.
// - a modal dialog (role dialog/alertdialog, not `modal: false`) is what a screen reader sees while it is open: the
//   page behind it is pruned, not marked hidden, as a browser hides the background of a modal.
//
// A container part whose box the page never made (a group's own id on no box: the page spreads only its items) takes
// the lowest common ancestor of its item boxes through `options.containers`. The adopted box keeps no id of its own,
// so its node has no bounds.
import { ui } from "./src/ffi.ts";
import { El, Txt } from "./src/renderer.ts";

/** The ARIA states a part carries. Absent means "no such state" (a leaf's `expanded`) or false; `disabled` and
 * `focused` are only written when true, as a tree shows them. */
export interface States {
  checked?: boolean | "mixed";
  expanded?: boolean;
  selected?: boolean;
  disabled?: boolean;
  focused?: boolean;
  hidden?: boolean;
}

export interface A11yNode {
  role: string;
  name?: string;
  /** The part's value: a text field's text, a slider's `valueText`. */
  value?: string;
  states: States;
  /** `aria-haspopup` of the part (`"menu"`, `"dialog"`). */
  hasPopup?: string;
  /** `aria-level` of a tree item. */
  level?: number;
  bounds?: [number, number, number, number];
  children: A11yNode[];
}

/** The fields a part exposes to the tree (a subset of every part of `headless/`), keyed by its id. */
export interface PartFields {
  readonly id: string;
  readonly role?: string;
  readonly label?: string;
  readonly labelledBy?: string;
  readonly checked?: boolean | "mixed";
  readonly expanded?: boolean;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly focused?: boolean;
  readonly hidden?: boolean;
  readonly level?: number;
  readonly value?: string;
  readonly valueText?: string;
  readonly hasPopup?: string;
  readonly modal?: boolean;
}

/** The fields of `PartFields`, as `a11y` puts them on a box. */
const FIELDS = [
  "id",
  "role",
  "label",
  "labelledBy",
  "checked",
  "expanded",
  "selected",
  "disabled",
  "focused",
  "hidden",
  "level",
  "value",
  "valueText",
  "hasPopup",
  "modal",
] as const;

/**
 * A part's `id` and accessibility fields as the props of the box that draws it: `<box {...bind(part)} {...a11y(part)}>`,
 * or for a part whose box takes no pointer itself, `<box {...a11y(part)}>`. Every field is a getter over the part's own,
 * so the box follows the part (a checkbox re-states itself when its part checks) and the snapshot reads the page's own
 * boxes, with no `parts` table to keep in step. The id is the one `ui.bounds` knows the box by.
 */
export function a11y(part: PartFields): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const key of FIELDS) Object.defineProperty(props, key, { enumerable: true, get: () => part[key] });
  return props;
}

/** A container part the page renders no box for: the node is the box that holds all of `items`. */
export interface Container {
  readonly part: PartFields;
  readonly items: readonly string[];
}

export interface SnapshotOptions {
  /** The parts of the page, by id: they fill in what a box does not carry itself (props win). */
  parts?: Iterable<PartFields>;
  /** Group parts whose box the page drops: adopted at the lowest common ancestor of their items. */
  containers?: readonly Container[];
}

interface Fields {
  role?: string;
  label?: string;
  labelledBy?: string;
  checked?: boolean | "mixed";
  expanded?: boolean;
  selected?: boolean;
  disabled?: boolean;
  focused?: boolean;
  hidden?: boolean;
  level?: number;
  value?: string;
  hasPopup?: string;
  modal?: boolean;
}

const encoder = new TextEncoder();
const idBytes = new Map<string, Uint8Array>();
const bytes = (id: string): Uint8Array => {
  let b = idBytes.get(id);
  if (!b) idBytes.set(id, (b = encoder.encode(id)));
  return b;
};

/** The page's tree as an accessibility snapshot: a `document` node over the boxes that carry a role. */
export function snapshot(root: El, options: SnapshotOptions = {}): A11yNode {
  const parts = new Map<string, PartFields>();
  for (const part of options.parts ?? []) parts.set(part.id, part);

  const findById = (id: string, from: El = root): El | undefined => {
    if (from.props.id === id) return from;
    for (const c of from.children) {
      if (!(c instanceof El)) continue;
      const hit = findById(id, c);
      if (hit) return hit;
    }
    return undefined;
  };
  const ancestors = (el: El): El[] => {
    const chain: El[] = [];
    for (let p: El | undefined = el; p; p = p.parent) chain.unshift(p);
    return chain;
  };
  // a group part whose box the page never made: the box that holds all of its items takes its fields
  const adopted = new Map<El, PartFields>();
  for (const { part, items } of options.containers ?? []) {
    const boxes = items.map((id) => findById(id)).filter((el): el is El => el !== undefined);
    if (boxes.length === 0) continue;
    const chains = boxes.map(ancestors);
    let depth = 0;
    while (chains.every((chain) => chain[depth] !== undefined && chain[depth] === chains[0]![depth])) depth++;
    const host = chains[0]![depth - 1];
    if (host !== undefined && host !== root) adopted.set(host, part);
  }

  const fields = (el: El): Fields => {
    const p = el.props;
    const part = (p.id === undefined ? undefined : parts.get(p.id)) ?? adopted.get(el);
    return {
      role: p.role ?? part?.role,
      label: p.label ?? part?.label,
      labelledBy: p.labelledBy ?? part?.labelledBy,
      checked: p.checked ?? part?.checked,
      expanded: p.expanded ?? part?.expanded,
      selected: p.selected ?? part?.selected,
      disabled: p.disabled ?? part?.disabled,
      focused: p.focused ?? part?.focused,
      hidden: p.hidden ?? part?.hidden,
      level: p.level ?? part?.level,
      // a text field's text is `value`, a slider's readout is `valueText`; a box may pass either
      value: p.value ?? p.valueText ?? part?.value ?? part?.valueText,
      hasPopup: p.hasPopup ?? part?.hasPopup,
      modal: p.modal ?? part?.modal,
    };
  };
  const hidden = (el: El): boolean => fields(el).hidden === true;

  // the modal dialog, when one is open: the snapshot is that subtree alone
  const modal = (function find(el: El): El | undefined {
    const f = fields(el);
    if (f.hidden !== true && (f.role === "dialog" || f.role === "alertdialog") && f.modal !== false) return el;
    for (const c of el.children) {
      if (!(c instanceof El)) continue;
      const hit = find(c);
      if (hit) return hit;
    }
    return undefined;
  })(root);
  const keep = new Set<El>();
  if (modal) {
    for (const el of ancestors(modal)) keep.add(el);
    (function descend(el: El) {
      keep.add(el);
      for (const c of el.children) if (c instanceof El) descend(c);
    })(modal);
  }
  const kept = (el: El): boolean => modal === undefined || keep.has(el);

  /** All the text under an element, as a label's text is read. */
  const textOf = (el: El): string => {
    let out = "";
    for (const c of el.children) {
      if (c instanceof Txt) out += c.text;
      else if (kept(c) && !hidden(c)) out += textOf(c);
    }
    return out;
  };
  /** The text of an element's own run: nested role nodes are their own names, not this one's. */
  const contents = (el: El): string => {
    let out = "";
    for (const c of el.children) {
      if (c instanceof Txt) {
        out += c.text;
        continue;
      }
      if (!kept(c)) continue;
      const f = fields(c);
      if (f.hidden === true || f.role !== undefined) continue;
      out += contents(c);
    }
    return out.trim();
  };
  const nameOf = (el: El, f: Fields): string | undefined => {
    if (f.label !== undefined) return f.label;
    if (f.labelledBy !== undefined) {
      const target = findById(f.labelledBy);
      const text = target === undefined ? "" : textOf(target).trim();
      if (text) return text;
    }
    return contents(el) || undefined;
  };
  const boundsOf = (el: El): A11yNode["bounds"] => {
    const id = el.props.id;
    if (id === undefined) return undefined;
    const box = ui.bounds(bytes(id));
    return box === undefined ? undefined : [box[0]!, box[1]!, box[2]!, box[3]!];
  };

  const document: A11yNode = { role: "document", states: {}, children: [] };
  const walk = (el: El, parent: A11yNode): void => {
    if (!kept(el)) return;
    const f = fields(el);
    if (f.hidden === true) return;
    let node = parent;
    if (f.role !== undefined) {
      node = { role: f.role, states: {}, children: [] };
      const states = node.states;
      if (f.checked !== undefined) states.checked = f.checked;
      if (f.expanded !== undefined) states.expanded = f.expanded;
      if (f.selected !== undefined) states.selected = f.selected;
      if (f.disabled === true) states.disabled = true;
      if (f.focused === true) states.focused = true;
      if (f.hasPopup !== undefined) node.hasPopup = f.hasPopup;
      if (f.level !== undefined) node.level = f.level;
      if (f.value !== undefined) node.value = f.value;
      const name = nameOf(el, f);
      if (name !== undefined) node.name = name;
      const bounds = boundsOf(el);
      if (bounds !== undefined) node.bounds = bounds;
      parent.children.push(node);
    }
    for (const c of el.children) if (c instanceof El) walk(c, node);
  };
  for (const c of root.children) if (c instanceof El) walk(c, document);
  return document;
}
