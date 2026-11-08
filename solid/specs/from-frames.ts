// `solid/specs/before-after.json`, `layer-stack.json`, `modal.json` and `transition-spec.json`, written from frames this
// script captures: the Widgets page's switch off and on, and the Dialog's modal and menu frames — captured the way
// solid/goldens stores a page's last frame (solid/dump.ts). The tree is the same in both switch frames, so a command's
// index is the same element, and the numbers a before/after is about are the commands whose fields differ: the track's
// colour and the thumb's x. Nothing in the spec is typed by hand but the two states' captions and the two parts' names,
// and the figures' own tests recompute the same numbers from fresh captures to hold the spec to the frames.
//
//   bun solid/specs/from-frames.ts                  # write the four specs, here
//   bun solid/specs/from-frames.ts "$TMPDIR/specs"  # ... or into another directory, for solid/test.sh's cmp
//
// Both switch frames are taken with the switch focused (`Tab,Tab`) and the second with Space after it, so the focus ring is
// the same command in both and the only fields that move are the two the figure is about. The transition's two frames are
// the dialog-menu scene's own keys, at the entry's start and at its settle.
import "../plugin.ts";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BLUR, GROW, OUT, SLIDE } from "../src/animations.ts";
import type { Command, FrameDump } from "../src/dump.ts";
import { frameOf } from "../src/figure/kinds/wireframe.ts";
import {
  check,
  type BeforeAfterData,
  type LayerStackData,
  type ModalData,
  type TransitionSpecData,
} from "../src/figure/spec.ts";


/** The keys the off frame is taken with: two Tabs reach the Wi-Fi switch and focus it. */
export const OFF_KEYS = ["Tab", "Tab"] as const;
/** ... and Space toggles it, so the on frame is the same page with one more key. */
export const ON_KEYS = ["Tab", "Tab", "Space"] as const;

/** The two states' captions: the page's own names for a switch's values. */
const CAPTIONS = ["off", "on"] as const;

/** One command that differs between two frames of one page, and the fields that differ. */
export interface Difference {
  index: number;
  fields: string[];
  before: Command;
  after: Command;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Every command whose fields differ, in the frame's order: the tree is the same, so an index is one element. */
export function differencesOf(off: FrameDump, on: FrameDump): Difference[] {
  if (off.commands.length !== on.commands.length)
    throw new Error(
      `the two frames have ${off.commands.length} and ${on.commands.length} commands: one tree is one command stream`,
    );
  return off.commands.flatMap((before, index) => {
    const after = on.commands[index]!;
    const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
      (field) => !same(before[field as keyof Command], after[field as keyof Command]),
    );
    return fields.length ? [{ index, fields, before, after }] : [];
  });
}

/** A colour's three channels as the figure prints them: `60,64,78`, the alpha dropped. */
const rgb = (colour: readonly number[] | undefined) => (colour ?? []).slice(0, 3).map(Math.round).join(",");

/**
 * The before/after data of two frames: the component's box (the command whose colour changed: the switch's track), the
 * colour the two states give it, and the thumb's own offset inside it (`box[0]` of the command whose x moved). Two changes
 * and no more — a page change that moves something else fails here rather than writing a figure about the wrong numbers.
 */
export function dataOf(off: FrameDump, on: FrameDump): BeforeAfterData {
  const differences = differencesOf(off, on);
  const coloured = differences.filter((difference) => difference.fields.includes("color"));
  const moved = differences.filter(
    (difference) => difference.fields.includes("box") && difference.before.box[0] !== difference.after.box[0],
  );
  if (differences.length !== 2 || coloured.length !== 1 || moved.length !== 1)
    throw new Error(
      `the frames differ in ${differences.length} command(s) (${differences
        .map((difference) => `#${difference.index} ${difference.fields.join("+")}`)
        .join(", ")}): the switch's two states are its track's colour and its thumb's x`,
    );
  const track = coloured[0]!;
  const thumb = moved[0]!;
  const width = Math.round(track.before.box[2]);
  const height = Math.round(track.before.box[3]);
  return {
    before: {
      caption: CAPTIONS[0],
      box: { width, height },
      measures: [
        { label: "the track", value: rgb(track.before.color) },
        { label: "the thumb", value: `${Math.round(thumb.before.box[0] - track.before.box[0])}px` },
      ],
    },
    after: {
      caption: CAPTIONS[1],
      box: { width, height },
      measures: [
        { label: "the track", value: rgb(track.after.color) },
        { label: "the thumb", value: `${Math.round(thumb.after.box[0] - track.before.box[0])}px` },
      ],
    },
  };
}

/** The keys the Dialog's modal frame is taken with: Tab reaches the "Settings" control, Enter opens it. */
export const MODAL_KEYS = ["Tab", "Enter"] as const;
/** ... and the menu's: two Tabs reach the "Zoom" control. */
export const MENU_KEYS = ["Tab", "Tab", "Enter"] as const;
/** The frames at rest after the overlay opens: the entry's group and shadow have settled (a property read mid-fade is
 *  the animation's, not the layer's). */
export const SETTLE = 40;

/** One layer's rectangle and effect rows: the page's own numbers, not a z scale typed into the spec. */
const layerOf = (name: string, frame: FrameDump, element: string) => {
  const command = frame.commands.find((c) => c.element === element && c.type === "rectangle");
  if (!command) throw new Error(`layerStack: ${element} is not a rectangle of its frame`);
  const [width, height] = [command.box[2]!, command.box[3]!];
  const blur = frame.effects.backdrops.find((backdrop) => backdrop.element === element)?.blur;
  const shadow = frame.effects.shadows.find((row) => row.element === element);
  return {
    name,
    z: command.z,
    box: { width, height },
    alpha: (command.color?.[3] ?? 255) / 255,
    radius: command.radii?.[0] ?? 0,
    ...(blur === undefined ? {} : { blur }),
    ...(shadow === undefined ? {} : { shadow: { x: shadow.x, y: shadow.y, blur: shadow.blur } }),
  };
};

/**
 * The Dialog's layers, back to front: the page, the modal's scrim and the dialog (its modal frame), and the menu (its
 * menu frame). Each row's z, box, alpha, radius, blur and shadow are that frame's own command and effect row for the
 * element, so a page that moves a float moves the figure.
 */
export function layersOf(modal: FrameDump, menu: FrameDump): LayerStackData {
  return [
    layerOf("the page", modal, "Root"),
    layerOf("the dialog's scrim", modal, "settings-backdrop"),
    layerOf("the dialog", modal, "settings-dialog"),
    layerOf("the menu", menu, "zoom-menu"),
  ];
}

/** The Dialog's modal as a wireframe's data: its frame's boxes and runs, the keys it was taken with and the panel. */
export function modalOf(frame: FrameDump, keys: readonly string[], settle: number): ModalData {
  const panel = frame.commands.find((c) => c.element === "settings-dialog" && c.type === "rectangle");
  if (!panel) throw new Error("modal: settings-dialog is not a rectangle of its frame");
  return {
    page: "dialog",
    keys: [...keys],
    settle,
    width: frame.size[0],
    height: frame.size[1],
    ...frameOf(frame.commands),
    panel: { x: panel.box[0]!, y: panel.box[1]!, width: panel.box[2]!, height: panel.box[3]! },
  };
}

/** The modal's spec: the Dialog with its modal open, the frame's own boxes and runs. */
export function modalSpecOf(data: ModalData) {
  return {
    kind: "modal" as const,
    title: "The Dialog, open",
    intent:
      "The Dialog page's frame with its modal open — the scrim over the whole page and the panel inside it — cut to the " +
      "cell grid, with the panel's own box under the drawing.",
    source: `solid/specs/from-frames.ts, the Dialog's modal frame (${data.keys.join(", ")}, settled)`,
    data,
  };
}


const rounded = (value: number, places = 2): number => Math.round(value * 10 ** places) / 10 ** places;
const instant = (frames: number): number => Math.round(frames * (1000 / 60) * 100) / 100;


/** The card's spec: one animation as a card, its sentence the page's own reason for it. */

/** The element the transition moves: the Dialog's menu, which slides out of its Zoom trigger. */
export const TRANSITION_ELEMENT = "zoom-menu";

/** A frame's rectangle for an element, as the transition's box: the command's own four numbers. */
function boxOf(frame: FrameDump, element: string): WireBox {
  const command = frame.commands.find((row) => row.element === element && row.type === "rectangle");
  if (!command) throw new Error(`transitionSpec: ${element} is not a rectangle of its frame`);
  return {
    x: rounded(command.box[0]!),
    y: rounded(command.box[1]!),
    width: rounded(command.box[2]!),
    height: rounded(command.box[3]!),
  };
}

/**
 * The transition's data, from two frames of one element: its box in each (the two boxes it moves between), and the
 * properties the frame tables say moved — the offset y (the box), the group's alpha, scale and rotation, and the
 * shadow's blur. A field the frame leaves out is the neutral one, which is what a settled group is.
 */
export function transitionOf(start: FrameDump, rest: FrameDump, scene: string, trigger: string): TransitionSpecData {
  const element = TRANSITION_ELEMENT;
  const from = boxOf(start, element);
  const to = boxOf(rest, element);
  const groupOf = (frame: FrameDump) => frame.effects.groups.find((row) => row.element === element);
  const shadowOf = (frame: FrameDump) => frame.effects.shadows.find((row) => row.element === element);
  const properties = [
    { name: "offset y", from: from.y, to: to.y, unit: "px" },
    { name: "alpha", from: groupOf(start)?.alpha ?? 255, to: groupOf(rest)?.alpha ?? 255, unit: "of 255" },
    {
      name: "scale",
      from: rounded((groupOf(start)?.scale ?? 1) * 100),
      to: rounded((groupOf(rest)?.scale ?? 1) * 100),
      unit: "%",
    },
    {
      name: "rotate",
      from: rounded(groupOf(start)?.rotate ?? 0),
      to: rounded(groupOf(rest)?.rotate ?? 0),
      unit: "deg",
    },
    {
      name: "shadow blur",
      from: rounded(shadowOf(start)?.blur ?? 0),
      to: rounded(shadowOf(rest)?.blur ?? 0),
      unit: "px",
    },
  ].filter((property) => property.from !== property.to);
  return {
    label: "the menu",
    page: "dialog",
    scene,
    trigger,
    from,
    to,
    properties,
    // the longest track driving the properties: the offset's, the blur's and the group's are 220ms, the fade's 200
    duration: Math.round(Math.max(SLIDE.duration, BLUR.duration, OUT.duration, GROW.duration) * 1000),
    delay: 0,
  };
}

/** The transition's spec: one recorded transition, before and after. */
export function transitionSpecOf(data: TransitionSpecData) {
  return {
    kind: "transitionSpec" as const,
    title: "The Dialog's menu, in",
    intent:
      "The menu's arrival as one transition: the box the frame draws at the entry's start and at its settle, and the " +
      "five properties that move between them — the offset, the group's alpha, scale and tilt, and the shadow's blur.",
    source: "solid/app/Dialog.tsx's springs, two frames of the dialog-menu scene",
    data,
  };
}

/** The layer stack's spec: the Dialog's own overlays, measured where each one opens. */
export function layerSpecOf(data: LayerStackData) {
  return {
    kind: "layerStack" as const,
    title: "The Dialog's layers, back to front",
    intent:
      "The page and the three surfaces the Dialog stacks over it, each read from its own frame: the scrim's alpha, " +
      "the dialog's shadow and the menu's glass are the page's, not a z scale's.",
    source: "solid/specs/from-frames.ts, the Dialog's modal and menu frames (settled)",
    data,
  };
}

/** The spec, with the two states' numbers and the source of every one of them. */
export function specOf(data: BeforeAfterData) {
  return {
    kind: "beforeAfter" as const,
    title: "The Wi-Fi switch, off and on",
    intent:
      "One component, twice: the track's colour and the thumb's x are the commands that differ between the two stored frames, so the figure's numbers are the page's.",
    source: "solid/specs/from-frames.ts, two frames of the Widgets page's switch",
    data,
  };
}

if (import.meta.main) {
  const { capture } = await import("../dump.ts");
  // the menu's keys are the recorded scene's own: the transition is what the file replays, not a second script
  const scene = JSON.parse(
    readFileSync(new URL("../scenes/dialog-menu.json", import.meta.url), "utf8"),
  ) as { name: string; steps: { kind: string; name: string; down: boolean }[] };
  const sceneKeys = scene.steps.filter((step) => step.kind === "key" && step.down).map((step) => step.name);
  if (sceneKeys.join(",") !== MENU_KEYS.join(","))
    throw new Error(`scenes/dialog-menu.json opens on ${sceneKeys.join(", ")}, not ${MENU_KEYS.join(", ")}`);
  const off = await capture("widgets", undefined, { keys: [...OFF_KEYS] });
  const on = await capture("widgets", undefined, { keys: [...ON_KEYS] });
  const modal = await capture("dialog", undefined, { keys: [...MODAL_KEYS], settle: SETTLE });
  const menu = await capture("dialog", undefined, { keys: [...MENU_KEYS], settle: SETTLE });
  const entry = await capture("dialog", undefined, { keys: [...MENU_KEYS], settle: 0 });
  const spec = specOf(dataOf(off, on));
  const layers = layerSpecOf(layersOf(modal, menu));
  const dialog = modalSpecOf(modalOf(modal, MODAL_KEYS, SETTLE));
  const transition = transitionSpecOf(
    transitionOf(entry, menu, scene.name, "Enter on the Zoom control"),
  );
  for (const one of [spec, layers, dialog, transition]) {
    const problems = check(one);
    if (problems.length) throw new Error(`${one.kind} would not draw: ${problems.join(" ")}`);
  }
  const dir = process.argv[2] ?? new URL(".", import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  for (const [name, one] of [
    ["before-after.json", spec],
    ["layer-stack.json", layers],
    ["modal.json", dialog],
    ["transition-spec.json", transition],
  ] as const) {
    writeFileSync(join(dir, name), `${JSON.stringify(one, null, 2)}\n`);
    console.log(`${name}: ${join(dir, name)}`);
  }
  const before = spec.data.before;
  const after = spec.data.after;
  console.log(
    `from-frames: the switch ${before.caption} -> ${after.caption}, ${before.box.width}x${before.box.height}; ` +
      `the layer stack ${layers.data.map((layer) => `${layer.name} z${layer.z}`).join(", ")}; the modal ` +
      `${dialog.data.boxes.length} boxes and ${dialog.data.texts.length} runs on ${dialog.data.panel.width}x` +
      `${dialog.data.panel.height}`,
  );
}
