// The flows area, one file for its kinds — their layout and their own refusals side by side, because that is what the
// next kind of this area costs: a layout function, a check, one `register` at the bottom, and nothing else.
//
//   flow         one row of boxes joined by arrows
//   branchFlow   a column of boxes with a decision's branch drawn to its right, connectors and their words as text
//   stateMachine a path's boxes in a column, each transition's event between them, the states off the path below
//
// A line here is one cell high, so a flow is one row and the two spine kinds put their connectors on rows of their own: a
// down arrow is a row of its own under the `|` that carries the word. Our glyphs are ASCII (`|`, `-`, `>`, `v`) because
// Roboto has none of `│ ─ ► ▼ →` and ThorVG has no fallback font, so the same figure reads on the pixels and the cells.
//
// branchFlow and stateMachine write their refusals in the kit's flow voice: "The path goes happened → paid, but no
// transition connects them" follows its `states` check's sentence, and the branch and state-machine sentences are ours,
// because the kit's published scripts check neither kind's data.
import type { BoxRecord, BoxRole, Connector, Item, Layout, LayoutLine } from "../registry.ts";
import { register } from "../registry.ts";
import type { BranchFlowSpec, FlowSpec, StateMachineSpec } from "../spec.ts";
import {
  arrowOf,
  cells,
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
} from "./shared.ts";

function flow(spec: FlowSpec): Layout {
  const focus = focusOf(spec);
  const labels = spec.data;
  const boxes = labels.map((label) => cells(label) + 2);
  const width = boxes.reduce((n, box) => n + box, 0) + Math.max(0, labels.length - 1) * 3;
  const items: Item[] = [];
  labels.forEach((label, i) => {
    items.push({
      kind: "box",
      id: `fig-box-${i}`,
      textId: `fig-box-text-${i}`,
      text: label,
      cells: boxes[i]!,
      paint: paintOf(focus, label),
      role: "step",
    });
    if (i < labels.length - 1)
      items.push({ kind: "text", id: `fig-arrow-${i}-cell`, textId: `fig-arrow-${i}`, text: " ► ", cells: 3, paint: "muted", role: "connector" });
  });
  return finish(
    spec,
    "flow",
    width,
    [{ items }],
    [],
    labels.map((label, i) => ({ textId: `fig-box-text-${i}`, text: label })),
  );
}

/**
 * A branch flow: one column of boxes, a decision's `no` box to its right, and the words as text. The main path goes down
 * as "yes"; the branch's arrow runs right from the decision's edge.
 */
function branchFlow(spec: BranchFlowSpec): Layout {
  const focus = focusOf(spec);
  const steps = spec.data;
  const branchOf = (step: (typeof steps)[number]) => (step.type === "decision" ? step.no : undefined);
  const branchText = (step: (typeof steps)[number]) => {
    const no = branchOf(step);
    return no ? `${no.label} -> ${no.to}` : "";
  };
  const W = Math.max(3, longest(steps.map((step) => step.label)) + 2);
  const center = Math.floor((W - 1) / 2);
  const lines: LayoutLine[] = [];
  const boxes: BoxRecord[] = [];
  const connectors: Connector[] = [];
  const labels: Layout["labels"] = [];
  let widest = W;
  steps.forEach((step, i) => {
    const no = branchOf(step);
    const role: BoxRole = i === steps.length - 1 ? "end" : step.type === "decision" ? "decision" : "step";
    const items: Item[] = [
      {
        kind: "box",
        id: `fig-box-${i}`,
        textId: `fig-box-text-${i}`,
        text: step.label,
        cells: W,
        paint: paintOf(focus, step.label),
        role,
      },
    ];
    boxes.push({ id: `fig-box-${i}`, textId: `fig-box-text-${i}`, text: step.label, role });
    labels.push({ textId: `fig-box-text-${i}`, text: step.label });
    if (no) {
      const arrow = arrowOf("no");
      const branch = branchText(step);
      const branchCells = cells(branch) + 2;
      items.push(textItem(`fig-arrow-${i}`, arrow, cells(arrow), "muted", "connector-label"));
      items.push({
        kind: "box",
        id: `fig-branch-${i}`,
        textId: `fig-branch-text-${i}`,
        text: branch,
        cells: branchCells,
        paint: paintOf(focus, no.label),
        role: "branch",
      });
      connectors.push({ textId: `fig-arrow-${i}`, text: "no", from: step.label, to: no.to, role: "branch" });
    }
    const width = items.reduce((n, item) => n + item.cells, 0);
    widest = Math.max(widest, width);
    lines.push({ items });
    if (i < steps.length - 1) {
      const word = step.type === "decision" ? " yes" : "";
      const down = `${" ".repeat(center)}${GLYPH.vertical}${word}`;
      widest = Math.max(widest, cells(down));
      lines.push({ items: [textItem(`fig-spine-${i}`, down, cells(down), "muted", "connector")] });
      const arrow = `${" ".repeat(center)}${GLYPH.down}`;
      lines.push({ items: [textItem(`fig-spine-down-${i}`, arrow, cells(arrow), "muted", "connector")] });
    }
  });
  return finish(spec, "branchFlow", widest, lines, [], labels, boxes, connectors);
}

/**
 * A state machine: the path's states in a column, each transition's event between them, and the states the path does not
 * visit listed under it. A state the path visits twice is drawn twice: it is the walk, not the set.
 */
function stateMachine(spec: StateMachineSpec): Layout {
  const focus = focusOf(spec);
  const states = spec.data.states;
  const transitions = spec.data.transitions;
  const path = spec.options?.path ?? [states[0]!];
  const W = Math.max(3, longest(states) + 2);
  const center = Math.floor((W - 1) / 2);
  const lines: LayoutLine[] = [];
  const boxes: BoxRecord[] = [];
  const connectors: Connector[] = [];
  const labels: Layout["labels"] = [];
  let widest = W;
  path.forEach((name, i) => {
    const role: BoxRole = i === 0 ? "start" : "state";
    lines.push({
      items: [
        {
          kind: "box",
          id: `fig-state-${i}`,
          textId: `fig-state-text-${i}`,
          text: name,
          cells: W,
          paint: paintOf(focus, name),
          role,
        },
      ],
    });
    boxes.push({ id: `fig-state-${i}`, textId: `fig-state-text-${i}`, text: name, role });
    labels.push({ textId: `fig-state-text-${i}`, text: name });
    if (i === path.length - 1) return;
    const next = path[i + 1]!;
    const event = transitions.find((t) => t.from === name && t.to === next)?.on ?? "";
    const word = event ? ` ${event}` : "";
    const edge = `${" ".repeat(center)}${GLYPH.vertical}${word}`;
    widest = Math.max(widest, cells(edge));
    lines.push({ items: [textItem(`fig-edge-${i}`, edge, cells(edge), "muted", "connector")] });
    const arrow = `${" ".repeat(center)}${GLYPH.down}`;
    lines.push({ items: [textItem(`fig-edge-down-${i}`, arrow, cells(arrow), "muted", "connector")] });
    connectors.push({ textId: `fig-edge-${i}`, text: event, from: name, to: next, role: "transition" });
  });
  const unvisited = states.filter((state) => !path.includes(state));
  if (unvisited.length) {
    const note = `not on the path: ${unvisited.join(", ")}`;
    widest = Math.max(widest, cells(note));
    lines.push({ items: [textItem("fig-unvisited", note, cells(note), "muted", "note")] });
  }
  return finish(spec, "stateMachine", widest, lines, [], labels, boxes, connectors);
}

/** A flow: labels in order, and the boxes with their arrows fit the width. */
function flowProblems(data: unknown, options: unknown): string[] {
  const labels = rowsOf(data);
  if (!labels.length) return ["A flow needs at least one box: its data is the labels in order."];
  const out: string[] = [];
  for (let i = 0; i < labels.length; i++) if (typeof labels[i] !== "string" || !(labels[i] as string).trim())
    out.push(`A flow's box ${i + 1} needs a label: a word or a line, not ${say(labels[i])}.`);
  const boxCells = labels.reduce<number>((n, label) => n + [...String(label)].length + 2, 0);
  const total = boxCells + Math.max(0, labels.length - 1) * 3;
  const width = isObject(options) && number(options.width) !== undefined ? number(options.width)! : 60;
  if (total > width)
    out.push(
      `These ${labels.length} boxes need ${total} cells with their arrows; the width is ${width}. Shorten a label or ` +
        `raise options.width.`,
    );
  return out;
}

/** A flow with decisions: each step a label, each decision a `no` branch that goes to a step or "end". */
function branchProblems(data: unknown): string[] {
  const steps = rowsOf(data);
  if (!steps.length)
    return ['A branch flow needs its steps: [{ "label": "read the spec" }, { "label": "check it", "type": "decision", "no": { "label": "refuse it", "to": "end" } }].'];
  const out: string[] = [];
  const names = new Set<string>();
  for (const [i, step] of steps.entries())
    if (isObject(step) && typeof step.label === "string" && step.label.trim()) names.add(step.label);
  for (const [i, step] of steps.entries()) {
    const label = labelOf(step, i);
    if (!isObject(step) || typeof step.label !== "string" || !step.label.trim()) {
      out.push(`${label} needs a label: a word or a line, not ${say(isObject(step) ? step.label : step)}.`);
      continue;
    }
    if (step.type !== undefined && step.type !== "decision")
      out.push(`${label}'s type is "decision" or left out: it is ${say(step.type)}.`);
    if (step.type !== "decision") continue;
    const no = step.no;
    if (!isObject(no) || typeof no.label !== "string" || !no.label.trim()) {
      out.push(`${label} has no "no" branch.`);
      continue;
    }
    if (typeof no.to !== "string" || !no.to.trim()) {
      out.push(`${label}'s "no" needs a "to": a step's label, or "end".`);
      continue;
    }
    if (no.to !== "end" && !names.has(no.to))
      out.push(`${label}'s "no" goes to "${no.to}", which is not a step.`);
  }
  return out;
}

/** A state machine: its states, transitions that name two of them, and a path that starts first and follows them. */
function stateProblems(data: unknown, options: unknown): string[] {
  const machine = isObject(data) ? data : {};
  const raw = Array.isArray(machine.states) ? machine.states : [];
  if (!raw.length)
    return ['A state machine needs its states: ["closed", "opening", "open", "closing"].'];
  const out: string[] = [];
  const states: string[] = [];
  for (const [i, name] of raw.entries())
    if (typeof name === "string" && name.trim()) states.push(name);
    else out.push(`State ${i + 1} needs a name: a word, not ${say(name)}.`);
  const transitions = Array.isArray(machine.transitions) ? machine.transitions : [];
  if (!transitions.length)
    out.push('A state machine needs its transitions: [{ "from": "closed", "to": "opening", "on": "open" }, ...].');
  for (const [i, t] of transitions.entries()) {
    if (!isObject(t) || typeof t.from !== "string" || typeof t.to !== "string" || typeof t.on !== "string") {
      out.push(`Transition ${i + 1} needs from, to and on: [{ "from": "closed", "to": "opening", "on": "open" }].`);
      continue;
    }
    const missing = [t.from, t.to].filter((name) => !states.includes(name));
    if (missing.length)
      out.push(
        `${t.from} goes to ${t.to} on "${t.on}", but ` +
          (missing.length === 1
            ? `"${missing[0]}" isn't one of the states.`
            : `neither "${missing[0]}" nor "${missing[1]}" is one of the states.`),
      );
  }
  const path = isObject(options) && Array.isArray(options.path) ? options.path : [states[0]];
  if (!path.length) return [...out, "A state machine's path needs at least one state: options.path is empty."];
  for (const name of path)
    if (typeof name !== "string" || !states.includes(name))
      out.push(`The path visits ${say(name)}, which isn't one of the states.`);
  const first = path[0];
  if (typeof first === "string" && states[0] !== undefined && first !== states[0])
    out.push(`The path starts at ${first}, but the machine's first state is ${states[0]}.`);
  for (let i = 1; i < path.length; i++) {
    const [from, to] = [path[i - 1], path[i]];
    if (typeof from !== "string" || typeof to !== "string") continue;
    if (!transitions.some((t) => isObject(t) && t.from === from && t.to === to))
      out.push(`The path goes ${from} → ${to}, but no transition connects them.`);
  }
  return out;
}

/** A flow's boxes are its strings; a branch flow's names are its steps and their branches; a path's are the path. */
function flowNames(data: unknown): string[] {
  return rowsOf(data).filter((s): s is string => typeof s === "string");
}

function branchNames(data: unknown): string[] {
  const names: string[] = [];
  for (const [i, step] of rowsOf(data).entries()) {
    names.push(labelOf(step, i));
    if (isObject(step) && isObject(step.no) && typeof step.no.label === "string" && step.no.label)
      names.push(step.no.label);
  }
  return names;
}

function stateNames(data: unknown, options: unknown): string[] {
  if (!isObject(data) || !Array.isArray(data.states)) return [];
  const states = data.states.filter((state): state is string => typeof state === "string" && state !== "");
  const path = isObject(options) && Array.isArray(options.path) ? options.path : [states[0]];
  return path.filter((state): state is string => typeof state === "string");
}

register("flow", { layout: flow, check: flowProblems, names: flowNames });
register("branchFlow", { layout: branchFlow, check: branchProblems, names: branchNames });
register("stateMachine", { layout: stateMachine, check: stateProblems, names: stateNames });
