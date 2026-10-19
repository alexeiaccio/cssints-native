// The Solid universal renderer. It builds no Clay tree itself: it keeps a JS tree of elements and texts, and
// frame.ts declares that tree to Clay each frame. Elements: `box` (a Clay element) and `text` (Clay text; its text
// children are joined). Props: `id`, `style` (a cssints/clay literal), `onClick`.
import { createRenderer } from "@solidjs/universal";

export class El {
  props: Record<string, any> = {};
  children: Node[] = [];
  parent?: El;
  constructor(public tag: string) {}
}
export class Txt {
  parent?: El;
  constructor(public text: string) {}
}
export type Node = El | Txt;

const detach = (n: Node) => {
  if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
  n.parent = undefined;
};
// ponytail: siblings are found by indexOf, O(children); a linked list when a page has long lists
const sibling = (n: Node) => n.parent?.children[n.parent.children.indexOf(n) + 1];

export const {
  render,
  effect,
  memo,
  createComponent,
  createElement,
  createTextNode,
  insertNode,
  insert,
  spread,
  setProp,
  mergeProps,
  applyRef,
  ref,
} = createRenderer<Node>({
  createElement(tag, staticProps) {
    const el = new El(tag);
    Object.assign(el.props, staticProps);
    return el;
  },
  createTextNode: (value) => new Txt(String(value)),
  replaceText(node, value) {
    (node as Txt).text = String(value);
  },
  isTextNode: (node) => node instanceof Txt,
  setProperty(node, name, value) {
    (node as El).props[name] = value;
  },
  insertNode(parent, node, anchor) {
    detach(node);
    const p = parent as El;
    const at = anchor ? p.children.indexOf(anchor) : -1;
    p.children.splice(at < 0 ? p.children.length : at, 0, node);
    node.parent = p;
  },
  removeNode: (_parent, node) => detach(node),
  getParentNode: (node) => node.parent,
  getFirstChild: (node) => (node as El).children[0],
  getNextSibling: sibling,
});

export { For, Show, Switch, Match, Errored, Loading, Reveal, Repeat } from "solid-js";
