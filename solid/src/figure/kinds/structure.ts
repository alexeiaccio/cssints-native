// The structure area, one file for its kinds — their layout and their own refusals side by side, because that is what
// the next kind of this area costs: a layout function, a check, one `register` at the bottom, and nothing else.
//
//   journeyMap   a stage a row: its label, a bar of |feeling|/2, the feeling's word, and its doing and thinking below
//   tree         the root above its children's rows, then each level, with | - + connectors between them
//
// This is the area of the second row: a tree's level is several boxes on one line, and a journey stage is a bar row with
// a note under it. `text.ts` reads the layout's items and has no kind in it, so both print there without a change.
//
// journeyMap's range sentence is the kit's own `within` check, word for word ("Import has a feeling of 3, outside -2 to
// 2."); its empty-journey sentence and the tree's three sentences are ours, because the kit's published scripts check
// neither kind's data (its `tree` has no check at all).
import type { Bar, BoxRecord, Connector, Item, Layout, LayoutLine, Paint } from "../registry.ts";
import { register } from "../registry.ts";
import type { JourneyMapSpec, TreeSpec, TreeNode } from "../spec.ts";
import {
  cells,
  fillOf,
  finish,
  focusOf,
  GLYPH,
  isObject,
  labelOf,
  longest,
  number,
  paintOf,
  rowsOf,
  say,
  textItem,
  treeRoot,
  type Json,
} from "./shared.ts";

/** The feeling's word, on the kit's scale: -2 bad, -1 poor, 0 neutral, 1 good, 2 great (a fraction rounds). */
const FEELING_WORDS = ["bad", "poor", "neutral", "good", "great"] as const;
const feelingWord = (feeling: number): string =>
  FEELING_WORDS[Math.max(-2, Math.min(2, Math.round(feeling))) + 2] ?? "neutral";
/** The number as the row prints it: "-2 bad", "0 neutral", "+2 great". */
const feelingText = (feeling: number): string => `${feeling > 0 ? "+" : ""}${feeling} ${feelingWord(feeling)}`;
/** A bad stage is the problem role, a good one the good role, and a flat one the ink. */
const feelingPaint = (feeling: number): Paint => (feeling > 0 ? "good" : feeling < 0 ? "problem" : "ink");

/**
 * A journey map: a stage a row, its label, a bar of |feeling|/2 (the kit's -2 to 2 scale), the feeling's word, and the
 * stage's doing and thinking under it. The bar is the magnitude, so a bad and a great stage are the same length and
 * their word and their role tell them apart.
 */
function journeyMap(spec: JourneyMapSpec): Layout {
  const focus = focusOf(spec);
  const stages = spec.data;
  const track = spec.options?.width ?? 8;
  const labelWidth = longest(stages.map((stage) => stage.label)) + 1;
  const texts = stages.map((stage) => feelingText(stage.feeling));
  const textWidth = longest(texts) + 1;
  const notes = stages.flatMap((stage) => [
    stage.doing ? `${" ".repeat(labelWidth)}${stage.doing}` : "",
    stage.thinking ? `${" ".repeat(labelWidth)}"${stage.thinking}"` : "",
  ]);
  const width = Math.max(labelWidth + track + textWidth, longest(notes));
  const bars: Bar[] = [];
  const labels: Layout["labels"] = [];
  const lines: LayoutLine[] = [];
  stages.forEach((stage, i) => {
    const value = Math.abs(stage.feeling);
    const fill = fillOf(value, 2, track);
    const paint = feelingPaint(stage.feeling);
    bars.push({
      fillId: `fig-fill-${i}`,
      trackId: `fig-track-${i}`,
      textId: `fig-num-${i}`,
      label: stage.label,
      value,
      max: 2,
      fill,
      track,
      text: texts[i]!,
    });
    labels.push({ textId: `fig-label-${i}`, text: stage.label });
    lines.push({
      items: [
        textItem(`fig-label-${i}`, stage.label, labelWidth, paintOf(focus, stage.label)),
        { kind: "bar", id: `fig-track-${i}`, fillId: `fig-fill-${i}`, cells: track, fill, paint },
        textItem(`fig-num-${i}`, texts[i]!, textWidth, paint),
      ],
    });
    if (stage.doing) {
      const note = `${" ".repeat(labelWidth)}${stage.doing}`;
      lines.push({ items: [textItem(`fig-doing-${i}`, note, cells(note), "muted", "note")] });
    }
    if (stage.thinking) {
      const note = `${" ".repeat(labelWidth)}"${stage.thinking}"`;
      lines.push({ items: [textItem(`fig-thinking-${i}`, note, cells(note), "muted", "note")] });
    }
  });
  return finish(spec, "journeyMap", width, lines, bars, labels);
}

/** A node of a tree, placed on the cell grid: its box's left cell and width, and its children's placements. */
interface Placed {
  node: TreeNode;
  depth: number;
  left: number;
  width: number;
  children: Placed[];
  index: number;
}

/**
 * A tree: the root above a row of its children, then each level under its parent, with three connector rows between
 * two levels — the parents' stems, the bracket that joins the children's centres, and the children's stems down. Cells
 * have no box drawing (Roboto has no `┌ ┬ ┐`; ThorVG has no fallback), so the bracket is `-` and `+` and the stems are
 * `|`, the same ASCII the other kinds' connectors use.
 */
function tree(spec: TreeSpec): Layout {
  const focus = focusOf(spec);
  const root = treeRoot(spec.data);
  if (!root) return finish(spec, "tree", 0, [], [], []);
  const gap = 2;
  const boxWidth = (node: TreeNode) => cells(node.name) + 2;
  const subtreeWidth = (node: TreeNode): number => {
    const kids = node.children ?? [];
    if (!kids.length) return boxWidth(node);
    return Math.max(boxWidth(node), kids.reduce((n, kid) => n + subtreeWidth(kid), 0) + gap * (kids.length - 1));
  };
  const place = (node: TreeNode, left: number, depth: number): Placed => {
    const width = subtreeWidth(node);
    const own = boxWidth(node);
    const kids = node.children ?? [];
    const kidsWidth = kids.reduce((n, kid) => n + subtreeWidth(kid), 0) + gap * Math.max(0, kids.length - 1);
    let x = left + Math.floor((width - kidsWidth) / 2);
    const children = kids.map((kid) => {
      const placed = place(kid, x, depth + 1);
      x += subtreeWidth(kid) + gap;
      return placed;
    });
    return { node, depth, left: left + Math.floor((width - own) / 2), width: own, children, index: 0 };
  };
  const placed = place(root, 0, 0);
  const gridWidth = subtreeWidth(root);
  const levels: Placed[][] = [];
  const collect = (node: Placed) => {
    (levels[node.depth] ??= []).push(node);
    for (const child of node.children) collect(child);
  };
  collect(placed);
  let index = 0;
  for (const level of levels) for (const node of level) node.index = index++;

  const centerOf = (node: Placed) => node.left + Math.floor((node.width - 1) / 2);
  const connectorLine = (id: string, chars: string[]): LayoutLine => {
    const text = chars.join("");
    return { items: [textItem(id, text, chars.length, "muted", "connector")] };
  };
  const lines: LayoutLine[] = [];
  const boxes: BoxRecord[] = [];
  const labels: Layout["labels"] = [];
  const connectors: Connector[] = [];
  levels.forEach((level, depth) => {
    if (depth > 0) {
      const parents = levels[depth - 1]!.filter((node) => node.children.length);
      const stem: string[] = Array(gridWidth).fill(" ");
      const bracket: string[] = Array(gridWidth).fill(" ");
      const down: string[] = Array(gridWidth).fill(" ");
      for (const parent of parents) {
        stem[centerOf(parent)] = GLYPH.vertical;
        const centres = parent.children.map(centerOf);
        const from = Math.min(...centres);
        const to = Math.max(...centres);
        for (let x = from; x <= to; x++) bracket[x] = GLYPH.line;
        for (const x of centres) bracket[x] = "+";
        bracket[centerOf(parent)] = "+";
        for (const x of centres) down[x] = GLYPH.vertical;
        for (const child of parent.children)
          connectors.push({
            textId: `fig-tree-branch-${depth}`,
            text: GLYPH.vertical,
            from: parent.node.name,
            to: child.node.name,
            role: "transition",
          });
      }
      lines.push(connectorLine(`fig-tree-stem-${depth}`, stem));
      lines.push(connectorLine(`fig-tree-bracket-${depth}`, bracket));
      lines.push(connectorLine(`fig-tree-down-${depth}`, down));
    }
    const items: Item[] = [];
    let x = 0;
    for (const node of level) {
      if (node.left > x)
        items.push({ kind: "space", id: `fig-tree-gap-${depth}-${x}`, cells: node.left - x, paint: "ink" });
      items.push({
        kind: "box",
        id: `fig-node-${node.index}`,
        textId: `fig-node-text-${node.index}`,
        text: node.node.name,
        cells: node.width,
        paint: paintOf(focus, node.node.name),
        role: node.depth === 0 ? "start" : "step",
      });
      boxes.push({
        id: `fig-node-${node.index}`,
        textId: `fig-node-text-${node.index}`,
        text: node.node.name,
        role: node.depth === 0 ? "start" : "step",
      });
      labels.push({ textId: `fig-node-text-${node.index}`, text: node.node.name });
      x = node.left + node.width;
    }
    lines.push({ items });
  });
  return finish(spec, "tree", gridWidth, lines, [], labels, boxes, connectors);
}

/**
 * A tree: glyph-kit's nested `{ name, children }`, or a flat parent/child list. Either way exactly one node is above
 * the rest, and every `parent` names a node in the list. The kit's published scripts check none of this: these
 * sentences are ours, in its voice.
 */
function treeProblems(data: unknown): string[] {
  const out: string[] = [];
  if (Array.isArray(data)) {
    if (!data.length) return ["A tree needs its root: a node with a name and no parent."];
    const nodes = data.filter(isObject);
    const names = new Set<string>();
    for (const [i, node] of data.entries()) {
      if (!isObject(node) || typeof node.name !== "string" || !node.name.trim()) {
        out.push(`Node ${i + 1} needs a name: a word, not ${say(isObject(node) ? node.name : node)}.`);
        continue;
      }
      names.add(node.name);
    }
    const roots = nodes.filter((node) => typeof node.name === "string" && node.name && !node.parent);
    if (!roots.length) out.push("A tree needs one root: every node names a parent, so none is above them.");
    else if (roots.length > 1)
      out.push(`A tree needs one root, but ${roots.map((node) => String(node.name)).join(", ")} have no parent.`);
    for (const node of nodes) {
      if (typeof node.name !== "string" || !node.name.trim()) continue;
      const parent = node.parent;
      if (parent === undefined || parent === null || parent === "") continue;
      if (typeof parent !== "string" || !names.has(parent))
        out.push(`${node.name} names ${say(parent)} as its parent, but there is no node named ${say(parent)}.`);
    }
    const root = roots.length === 1 ? roots[0]! : undefined;
    if (root && out.length === 0) {
      const reached = new Set<string>();
      const walk = (node: Json) => {
        if (typeof node.name !== "string" || reached.has(node.name)) return;
        reached.add(node.name);
        for (const child of nodes) if (child.parent === node.name) walk(child);
      };
      walk(root);
      const lost = [...names].filter((name) => !reached.has(name));
      if (lost.length) out.push(`${lost[0]} is not under the root ${String(root.name)}: its parents form a loop.`);
    }
    return out;
  }
  if (!isObject(data)) return ['A tree needs its root: { "name": "Settings", "children": [...] }, or a parent/child list.'];
  const walk = (node: unknown, parent: string | undefined) => {
    if (!isObject(node) || typeof node.name !== "string" || !node.name.trim()) {
      out.push(
        parent === undefined
          ? "A tree needs its root: the outermost node has no name."
          : `${parent}'s child needs a name: a word, not ${say(isObject(node) ? node.name : node)}.`,
      );
      return;
    }
    if (node.children !== undefined && !Array.isArray(node.children)) {
      out.push(`${node.name}'s children need a list: it is ${say(node.children)}.`);
      return;
    }
    for (const child of node.children ?? []) walk(child, node.name);
  };
  walk(data, undefined);
  return out;
}

/** A journey: a label and a feeling a stage, and the feeling inside the kit's -2 to 2 scale. */
function journeyProblems(data: unknown): string[] {
  const stages = rowsOf(data);
  if (!stages.length)
    return ['A journey needs its stages: [{ "label": "Discover", "feeling": 1 }, ...], each with the feeling it had.'];
  const out: string[] = [];
  const feelings: (number | undefined)[] = [];
  for (const [i, stage] of stages.entries()) {
    const feeling = isObject(stage) ? number(stage.feeling) : undefined;
    feelings.push(feeling);
    if (!isObject(stage) || typeof stage.label !== "string" || !stage.label.trim() || feeling === undefined)
      out.push(`${labelOf(stage, i)} needs a label and a feeling: a number from -2 to 2.`);
  }
  for (const [i, feeling] of feelings.entries())
    if (feeling !== undefined && (feeling < -2 || feeling > 2))
      out.push(`${labelOf(stages[i], i)} has a feeling of ${feeling}, outside -2 to 2.`);
  return out;
}

/** The names a tree draws, in the data's order: a nested node's walk, or a flat list's own names. */
function treeNames(data: unknown): string[] {
  const names: string[] = [];
  const walk = (node: unknown) => {
    if (!isObject(node) || typeof node.name !== "string" || !node.name) return;
    names.push(node.name);
    if (Array.isArray(node.children)) for (const child of node.children) walk(child);
  };
  if (Array.isArray(data)) {
    for (const node of data) if (isObject(node) && typeof node.name === "string" && node.name) names.push(node.name);
    return names;
  }
  walk(data);
  return names;
}

register("journeyMap", { layout: journeyMap, check: journeyProblems });
register("tree", { layout: tree, check: treeProblems, names: treeNames });
