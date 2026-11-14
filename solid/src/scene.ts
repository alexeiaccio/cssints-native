// A scene: one file of typed events with times, replayed into a page's own frame loop — the record of an input sequence,
// not of one state (Rune's item 4 in docs/map.md). `--keys`, `--click` and `--wheel` store a state each; a scene stores
// what made it, so the same file can drive the Solid page, the generated C page, the wasm in the browser and the board.
// The shape is plain JSON — strings, numbers, booleans and arrays — and every step lands on a frame (`t` is seconds from
// the start, rounded to the nearest 1/60s), because a frame is the unit that carries input. The schema is in
// native/README.md ("A scene as a file").
import "../plugin.ts";

import { readFileSync } from "node:fs";

import type { Drag } from "../app/Widgets.tsx";
import type { Motion } from "./entry.ts";
import { ui } from "./ffi.ts";
import { diffImages } from "./diff.ts";
import { createDrawer, createFrame, type View } from "./frame.ts";
import { createInput, type Input } from "./input.ts";
import { setReducedMotion } from "./motion.ts";
import { El, render, type Node } from "./renderer.ts";

/** The pages a scene may name (`bun solid/main.ts <page>`). */
export const PAGES = ["sensors", "widgets", "dialog", "form", "list", "storybook"] as const;
export type ScenePage = (typeof PAGES)[number];
/** The steps a scene may carry. */
export const KINDS = ["key", "text", "pointer", "wheel", "settle", "frame"] as const;
/** A frame is the unit of input: a step's time is rounded to the nearest one, and one frame is 1/60s. */
export const FPS = 60;

/** One typed event at `t` seconds from the scene's start. */
export type Step =
  /** A key's state: `name` is what the parts and the focus manager take ("Tab", "Shift+Tab", "ArrowDown", "Enter",
   *  "Space"), `down` says pressed or released. A press and its release at the same `t` are one tap, as a key event is. */
  | { readonly t: number; readonly kind: "key"; readonly name: string; readonly down: boolean }
  /** Typed characters (`Input.textInput`), not a key: a composed run, as SDL's TEXT_INPUT delivers it. */
  | { readonly t: number; readonly kind: "text"; readonly text: string }
  /** The pointer in the layout's pixels: `down` is the button, `touch` marks it as a finger's (one pointer either way). */
  | {
      readonly t: number;
      readonly kind: "pointer";
      readonly x: number;
      readonly y: number;
      readonly down: boolean;
      readonly touch: boolean;
    }
  /** A wheel delta in SDL's units, the ones `ui.wheel` takes: `dy: -1` is one notch down, `dx: -1` one notch right. */
  | { readonly t: number; readonly kind: "wheel"; readonly dx: number; readonly dy: number }
  /** Nothing for `frames` frames: a page's motion at rest (the `--settle` of the flags). */
  | { readonly t: number; readonly kind: "settle"; readonly frames: number }
  /** Exactly one frame, with nothing in it: a frame boundary stated rather than left to the gap between two steps. */
  | { readonly t: number; readonly kind: "frame" };

export interface Scene {
  /** The stored frame it reproduces (`solid/frames/<name>.png`), and the name a failure prints. */
  readonly name: string;
  readonly page: ScenePage;
  /** The story a `storybook` scene opens (`widgets--switch`): the page's other half, so a frame names what it shows. */
  readonly story?: string;
  /** The window's size in pixels: it must be the page's own, and a future C or wasm host lays out at it. */
  readonly size: readonly [number, number];
  readonly theme: "dark" | "light";
  /** No travel and no waiting, as `--reduced-motion` (the platform's ask, recorded in the scene). */
  readonly reducedMotion: boolean;
  readonly steps: readonly Step[];
}

/** The frame a time belongs to: frames are 1/60s (`FPS`) and a time is rounded to the nearest one. */
export const frameOf = (t: number): number => Math.round(t * FPS);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * A scene from its JSON text. Every failure names the file (`source`), and a bad step its index and the reason: a
 * scene is a record, so a file that cannot be replayed says where it stopped being one.
 */
export function parseScene(text: string, source = "scene"): Scene {
  const fail = (what: string): never => {
    throw new Error(`${source}: ${what}`);
  };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    fail(`not JSON: ${(e as Error).message}`);
  }
  if (!isRecord(raw)) fail("a scene is an object");
  const name = raw.name;
  if (typeof name !== "string" || name === "") fail("name must be a non-empty string");
  const page = raw.page;
  if (!PAGES.includes(page as ScenePage))
    fail(`page ${JSON.stringify(page)} is not ${PAGES.slice(0, -1).join(", ")} or ${PAGES[PAGES.length - 1]}`);
  const size = raw.size;
  if (
    !Array.isArray(size) ||
    size.length !== 2 ||
    !size.every((v) => typeof v === "number" && Number.isInteger(v) && v > 0)
  )
    fail("size must be [width, height], two whole pixels");
  const theme = raw.theme;
  if (theme !== "dark" && theme !== "light") fail(`theme ${JSON.stringify(theme)} is not "dark" or "light"`);
  if (raw.reducedMotion !== undefined && raw.reducedMotion !== true) fail("reducedMotion is true, or left out");
  // the story is the storybook's, and only its: a file that names one for another page says something it does not mean
  if (raw.story !== undefined && (typeof raw.story !== "string" || raw.story === ""))
    fail("story must be a non-empty string, or left out");
  if (raw.story !== undefined && page !== "storybook") fail(`page ${JSON.stringify(page)} has no stories`);
  if (!Array.isArray(raw.steps)) fail("steps must be an array");

  const steps: Step[] = [];
  let previous: { t: number; at: number } | undefined;
  raw.steps.forEach((s: unknown, i: number) => {
    const at: (what: string) => never = (what) => fail(`step ${i}: ${what}`);
    if (!isRecord(s)) at("a step is an object");
    const t = s.t;
    if (!isNumber(t) || t < 0) at("t must be a number of seconds from the start, 0 or more");
    const frame = frameOf(t);
    if (previous && frame < previous.at)
      at(`out of order: t ${t} is frame ${frame}, after a step at t ${previous.t} (frame ${previous.at})`);
    previous = { t, at: frame };
    const kind = s.kind;
    switch (kind) {
      case "key": {
        const [key, down] = [s.name, s.down];
        if (typeof key !== "string" || key === "" || typeof down !== "boolean")
          at(`a key step is { "t", "kind": "key", "name", "down" }`);
        steps.push({ t, kind: "key", name: key, down });
        break;
      }
      case "text": {
        const typed = s.text;
        if (typeof typed !== "string" || typed === "") at(`a text step is { "t", "kind": "text", "text" }`);
        steps.push({ t, kind: "text", text: typed });
        break;
      }
      case "pointer": {
        const [x, y, down] = [s.x, s.y, s.down];
        if (!isNumber(x) || !isNumber(y) || typeof down !== "boolean")
          at(`a pointer step is { "t", "kind": "pointer", "x", "y", "down" }`);
        if (s.touch !== undefined && typeof s.touch !== "boolean") at(`touch is true, false or left out`);
        steps.push({ t, kind: "pointer", x, y, down, touch: s.touch === true });
        break;
      }
      case "wheel": {
        const [dx, dy] = [s.dx, s.dy];
        if (!isNumber(dx) || !isNumber(dy)) at(`a wheel step is { "t", "kind": "wheel", "dx", "dy" }`);
        steps.push({ t, kind: "wheel", dx, dy });
        break;
      }
      case "settle": {
        const frames = s.frames;
        if (typeof frames !== "number" || !Number.isInteger(frames) || frames < 0)
          at(`a settle step is { "t", "kind": "settle", "frames" }: a whole number of frames, 0 or more`);
        steps.push({ t, kind: "settle", frames });
        break;
      }
      case "frame":
        steps.push({ t, kind: "frame" });
        break;
      default:
        at(`kind ${JSON.stringify(kind)} is not ${KINDS.slice(0, -1).join(", ")} or ${KINDS[KINDS.length - 1]}`);
    }
  });
  return {
    name,
    page: page as ScenePage,
    ...(raw.story === undefined ? {} : { story: raw.story as string }),
    size: [size[0] as number, size[1] as number],
    theme,
    reducedMotion: raw.reducedMotion === true,
    steps,
  };
}

/** What a run hands back: the page's tree as the last frame declared it, for a test's ending state. */
export interface SceneRun {
  /** The frames the replay ran: 0 .. frames − 1; the last is the one written or compared. */
  readonly frames: number;
  /** The page's Solid tree (an `El` root, as the last frame left it). */
  readonly root: El;
  readonly input: Input;
  readonly dispose: () => void;
}

/** The page's module, its size and the element `main.ts` renders for it: the one table of what a scene's page is. */
async function pageOf(
  page: ScenePage,
  story: string | undefined,
  host: { input: Input; motion: Motion; drag: Drag; theme: () => string | undefined },
): Promise<{ size: { width: number; height: number }; element: () => Node }> {
  switch (page) {
    case "sensors": {
      const { Sensors } = await import("../app/Sensors.tsx");
      return { size: { width: 360, height: 360 }, element: () => Sensors({ motion: host.motion }) };
    }
    case "widgets": {
      const { Widgets, size } = await import("../app/Widgets.tsx");
      return {
        size,
        element: () => Widgets({ input: host.input, drag: host.drag, motion: host.motion }),
      };
    }
    case "dialog": {
      const { Dialog, size } = await import("../app/Dialog.tsx");
      return { size, element: () => Dialog({ input: host.input, motion: host.motion }) };
    }
    case "form": {
      const { Field, size } = await import("../app/Field.tsx");
      return { size, element: () => Field({ input: host.input, motion: host.motion }) };
    }
    case "list": {
      const { List, size } = await import("../app/List.tsx");
      return { size, element: () => List({ input: host.input, motion: host.motion }) };
    }
    case "storybook": {
      const { Storybook, size } = await import("../app/Storybook.tsx");
      return {
        size,
        element: () => Storybook({ input: host.input, motion: host.motion, start: story }),
      };
    }
  }
}

/**
 * Replays a scene into its page: the loop `main.ts` runs headless — one frame a step at 1/60s, declared and laid out
 * every frame and drawn when the hash changed or the step was a discrete input (a key, typed text, a wheel, a press or
 * a release). The pointer keeps its last place between steps (it starts off the window at −1,−1); a key, text, wheel or
 * settle step leaves it there. The page, the theme and reduced motion are the file's, not the environment's.
 */
export async function runScene(scene: Scene): Promise<SceneRun> {
  const root = new El("root");
  const input = createInput();
  let theme: string | undefined = scene.theme === "light" ? "light" : undefined;
  // `t` is the page's shortcut only while no text field has focus: a letter typed into one is a character, not a key
  input.fallback = (name) =>
    name === "t" && !input.editing() ? ((theme = theme ? undefined : "light"), true) : false;
  const drag: Drag = {};
  const motion: Motion = {};
  const host = { input, motion, drag, theme: () => theme };
  const { size, element } = await pageOf(scene.page, scene.story, host);
  if (scene.size[0] !== size.width || scene.size[1] !== size.height)
    throw new Error(
      `page ${scene.page} is ${size.width}x${size.height}, the scene ${scene.size[0]}x${scene.size[1]}`,
    );
  setReducedMotion(scene.reducedMotion);
  const font = new URL("../../vendor/fonts/Roboto-Regular.ttf", import.meta.url).pathname;
  if (ui.init(size.width, size.height) || ui.font(font) < 0)
    throw new Error("ui_init or ui_font failed (is build/solid/libui.dylib built?)");
  const dispose = render(() => element(), root);
  const view: View = {
    get theme() {
      return theme;
    },
    // the pointer goes to both hooks: the Widgets slider's drag and the page's own (the Sky feed, the List's viewport)
    onPointer: (x, y, down, touch) => {
      drag.onPointer?.(x, y, down);
      motion.onPointer?.(x, y, down, touch);
    },
    onPressMiss: () => input.pressMiss(),
    onWheel: (dx, dy) => motion.onWheel?.(dx, dy),
    tick: (dt) => motion.tick?.(dt),
  };
  const draw = createDrawer(createFrame(root, view));

  // the timeline: every step at its frame, and the last frame any step needs (a settle's own last one)
  const timeline = scene.steps.map((step) => ({ step, at: frameOf(step.t) }));
  let frames = 0;
  for (const { step, at } of timeline)
    frames = Math.max(frames, step.kind === "settle" ? at + step.frames : at + 1);

  let px = -1;
  let py = -1;
  let down = false;
  let touch = false;
  const wheel = new Float32Array(2);
  let next = 0;
  for (let f = 0; f < frames; f++) {
    let discrete = false;
    while (next < timeline.length && timeline[next]!.at === f) {
      const step = timeline[next++]!.step;
      switch (step.kind) {
        case "key":
          if (step.down) input.down(step.name);
          else input.up(step.name);
          discrete = true;
          break;
        case "text":
          input.textInput(step.text);
          discrete = true;
          break;
        case "pointer":
          // a press or a release is discrete; a move draws through the hash, as the window's pointer does
          if (step.down !== down) discrete = true;
          px = step.x;
          py = step.y;
          down = step.down;
          touch = step.touch;
          break;
        case "wheel":
          // the same path `--wheel` takes: the delta into the host's channel, drained into the page before the frame
          ui.wheel(step.dx, step.dy);
          while (ui.wheelPop(wheel)) motion.onWheel?.(wheel[0]!, wheel[1]!);
          discrete = true;
          break;
        case "settle":
        case "frame":
          break;
      }
    }
    draw(px, py, down, 1 / FPS, discrete, touch);
  }
  return { frames, root, input, dispose };
}

export interface SceneFileOptions {
  /** Write the last frame here. */
  readonly png?: string;
  /** Compare the last frame with this PNG pixel for pixel; exit 1 and write `<expect>.actual.png` on a difference. */
  readonly expect?: string;
}

/** `main.ts --scene`: a file, replayed, its last frame written or compared. Returns the exit status. */
export async function runSceneFile(path: string, options: SceneFileOptions = {}): Promise<number> {
  let scene: Scene;
  try {
    scene = parseScene(readFileSync(path, "utf-8"), path);
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
  let run: SceneRun;
  try {
    run = await runScene(scene);
  } catch (e) {
    console.error(`${path}: ${(e as Error).message}`);
    return 1;
  }
  console.log(
    `scene ${path}: ${scene.page} ${scene.size[0]}x${scene.size[1]}, ${scene.theme}` +
      `${scene.reducedMotion ? ", reduced motion" : ""}, ${scene.steps.length} steps, ${run.frames} frames`,
  );
  let status = ui.errors() ? 1 : 0;
  if (options.png) ui.savePng(options.png);
  if (options.expect) {
    const actual = `${options.expect}.actual.png`;
    const n = ui.diffPng(options.expect, actual);
    if (n) {
      // the count says something moved; the box says where
      const [ref, frame] = [ui.png(options.expect), ui.png(actual)];
      const box = ref && frame ? diffImages(ref, frame)?.bounds : undefined;
      console.error(
        `${options.expect}: ${n} pixels differ` +
          (n < 0 ? " (-1: missing or another size)" : box ? ` in a ${box.width}x${box.height} box at ${box.x},${box.y}` : "") +
          `; this frame is ${actual}`,
      );
      status = 1;
    } else console.log(`${options.expect}: identical`);
  }
  run.dispose();
  return status;
}
