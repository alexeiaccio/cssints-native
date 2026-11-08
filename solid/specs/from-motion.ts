// The motion specs' numbers are **the solver's and the pages'**, not typed: this script runs `solid/src/motion.ts` itself
// at a fixed clock and writes motion-timing.json, easing.json, stagger.json, frame-strip.json and easing-table.json, so a
// change to the spring — or to a constant in `solid/src/animations.ts`, which the pages run on — changes the figure in
// the same commit. `solid/test.sh` regenerates them into a temp directory and `cmp`s (`--check` does both and exits
// non-zero with cmp's line). The card and the transition come from the pages' own frames (`from-frames.ts`).
//
//   bun native/solid/specs/from-motion.ts            rewrites the five specs here in place
//   bun native/solid/specs/from-motion.ts <dir>      writes them into <dir> (the check's own way: it writes nothing)
//   bun native/solid/specs/from-motion.ts --check    writes into a temp dir and cmps; a drift is a cmp line, exit 1
//
// The clock is passed in (`Track` never reads the time), so a headless run is exact: every sample below is `at(1/60 · n)`
// or a step of it, in the order the page would present them. Which numbers the README already records, checked here so
// the figure cannot disagree with the prose: the Dialog's panel's entry (`149.88, 151.07, 153.49, 156.07, 158.33` at
// `spatial(0.22, 0.1)`, one frame a value), its exit (`163.88, 165.24, 167.82, 170.39` at `spatial(0.2, 0)`), the menu's
// slide (`-10.00, -10.85, -12.58, -14.42, -16.04` at `spatial(0.22, 0.1)`) and the Sky cards' 50ms stagger (three frames
// at 60Hz). `check` prints them as it goes; the measured frames are the page's own real dt, so the exit's two last values
// are a hundredth off the solver's and that is said rather than hidden.
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  CARD_ENTRY,
  CARD_ENTRY_A,
  CARD_ENTRY_Y,
  GROW,
  HOVER,
  OUT,
  OUT_SLIDE,
  SLIDE,
} from "../src/animations.ts";
import { decay, effect, spatial, track, type Spring } from "../src/motion.ts";

/** The clock every sample is taken on: one sixtieth of a second, the frame a headless page runs at. */
const DT = 1 / 60;
/** A sample is written to two places — the README's precision — so the figure prints what the prose records. */
const value = (x: number): number => Math.round(x * 100) / 100;
/** A sample's instant in ms, to two places: 16.67 is the frame's own number, where a whole ms would be a different one. */
const ms = (frames: number): number => Math.round(frames * DT * 1000 * 100) / 100;
/** The instants a row is printed at, in the solver's seconds: the sample is taken *at* its printed ms, not near it, so
 *  the sample list is the model's at the times it says. */
const at = (frames: number): number => ms(frames) / 1000;

interface Sample {
  ms: number;
  value: number;
}

/** A spring's samples, one every `step` frames until the solver calls it settled (the settle frame is the last one). */
function springSamples(from: number, to: number, spring: Spring, step = 1): Sample[] {
  const t = track(from, spring);
  t.target = to;
  const out: Sample[] = [];
  for (let frame = 0; frame <= 600; frame += step) {
    const sample = t.at(at(frame));
    out.push({ ms: ms(frame), value: value(sample.x) });
    if (sample.done) break;
  }
  return out;
}

/** Every `step`-th sample, and the last one always: a strip shows a step in time and where the motion ends. */
function stride(samples: Sample[], step: number): Sample[] {
  const out = samples.filter((_, i) => i % step === 0);
  const last = samples[samples.length - 1]!;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** A fling's samples: one every `step` frames until the decay stops on its projection. */
function flingSamples(from: number, velocity: number, step = 1): Sample[] {
  const d = decay(from, velocity);
  const out: Sample[] = [];
  for (let frame = 0; frame <= 6000; frame += step) {
    const sample = d.at(at(frame));
    out.push({ ms: ms(frame), value: value(sample.x) });
    if (sample.done) break;
  }
  return out;
}

/** The frame a spring settles on, for a note. */
const settleFrame = (from: number, to: number, spring: Spring): number => {
  const samples = springSamples(from, to, spring);
  return samples[samples.length - 1]!.ms;
};

const PANEL = { start: 149.88, target: 163.88 }; // the panel's box y, 14px below its trigger's corner
// the pages' own springs, from src/animations.ts: the figure and Dialog.tsx/Sky.tsx read one constant, so the figure's
// samples cannot drift from the motion a page runs
const PANEL_IN = GROW; // Dialog.tsx's panel entry
const PANEL_OUT = OUT_SLIDE; // ... and its exit
const MENU_IN = SLIDE; // the menu's slide out of its trigger (offset y -10 → -20)

const motionTiming = {
  kind: "motionTiming",
  title: "The dialog out, the menu in",
  intent:
    "Two of the Dialog's tracks as the solver presents them, a bar a sample: the panel's exit (0.2s, no bounce) and the " +
    "menu's slide (-10 → -20px, 0.22s, a light bounce), with the row the settle rule snaps marked.",
  source: "solid/src/motion.ts at 1/60 (Track.at); README's motion chapter",
  data: {
    tracks: [
      {
        label: "the panel, out",
        start: 163.88,
        target: 177.88,
        motion: { kind: "spatial", duration: 200, bounce: 0 },
        samples: springSamples(163.88, 177.88, PANEL_OUT, 3),
      },
      {
        label: "the menu, in",
        start: -10,
        target: -20,
        motion: { kind: "spatial", duration: 220, bounce: 0.1 },
        samples: springSamples(-10, -20, MENU_IN, 3),
      },
    ],
  },
};

const easing = {
  kind: "easing",
  title: "Effect and spatial, one travel",
  intent:
    "The Dialog's panel entry (spatial(0.22, 0.1) from 149.88 to 163.88) and the same travel on effect(0.22): a dot a " +
    "sample, the instants across and the values down, one scale for both.",
  source: "solid/src/motion.ts at 1/60 (Track.at), a sample a frame",
  data: {
    curves: [
      {
        label: "the panel in",
        start: PANEL.start,
        target: PANEL.target,
        motion: { kind: "spatial", duration: 220, bounce: 0.1 },
        samples: springSamples(PANEL.start, PANEL.target, PANEL_IN),
      },
      {
        label: "the panel in, on effect",
        start: PANEL.start,
        target: PANEL.target,
        motion: { kind: "effect", duration: 220 },
        samples: springSamples(PANEL.start, PANEL.target, effect(0.22)),
      },
    ],
  },
};

const STAGGER = Math.round(CARD_ENTRY.delay * 1000); // ms: 3 frames at 60Hz, each card after the one above it
const CARD_MS = Math.round(CARD_ENTRY.time * 1000); // the card's entry duration
const stagger = {
  kind: "stagger",
  title: "The feed's three cards, 50ms apart",
  intent:
    "The Sky feed's first mount: each card 12px low and at 0 opacity, settling on its literals in 300ms, each waiting " +
    "50ms longer than the one above it so the feed fills in rather than popping.",
  source: "solid/app/Sky.tsx (spatial(0.3), 50ms a card); README",
  data: {
    items: [0, 1, 2].map((i) => ({ label: `card ${i + 1}`, delay: i * STAGGER, duration: CARD_MS })),
  },
};

// the fling: the Sky feed's drag released at 11.48px, the speed of its last five frames — 87.03 px/s, whose decay lands
// on 54.95 (solid/sky.test.ts's number)
const FLING = { start: 11.48, velocity: 87.03 };
const panelEntry = springSamples(PANEL.start, PANEL.target, PANEL_IN);
const frameStrip = {
  kind: "frameStrip",
  title: "The panel's drop, the feed's fling",
  intent:
    "The panel's entry a frame of it every fourth of a sixtieth — the README's recorded y list — and the feed's drag " +
    "released at 11.48px, a row every 200ms of its decay to 54.95.",
  source: "solid/src/motion.ts (Track.at, Decay.at); README's lists",
  data: {
    strips: [
      {
        label: "the panel's drop",
        start: PANEL.start,
        target: PANEL.target,
        motion: { kind: "spatial", duration: 220, bounce: 0.1 },
        frames: stride(panelEntry, 4),
      },
      {
        label: "the feed's fling",
        start: FLING.start,
        motion: { kind: "decay", velocity: FLING.velocity },
        frames: stride(flingSamples(FLING.start, FLING.velocity), 12),
      },
    ],
  },
};

/** The README's recorded numbers, and whether the solver makes them: the honesty check on this script. */
function recorded(): string[] {
  const out: string[] = [];
  const compare = (what: string, want: number[], got: number[]) => {
    const off = want.map((v, i) => Math.abs(v - got[i]!));
    const worst = Math.max(...off);
    out.push(
      `${what}: the README's ${want.join(", ")}; the solver's ${got.map((v) => value(v).toFixed(2)).join(", ")} — ` +
        `${worst <= 0.011 ? "the same" : `${worst.toFixed(2)}px apart`} (worst ${worst.toFixed(3)}px)`,
    );
  };
  const frames = (from: number, to: number, spring: Spring, n: number) =>
    springSamples(from, to, spring).slice(0, n).map((sample) => sample.value);
  compare(
    "the Dialog's panel entry",
    [149.88, 151.07, 153.49, 156.07, 158.33],
    frames(149.88, 163.88, PANEL_IN, 5),
  );
  compare("the Dialog's panel exit", [163.88, 165.24, 167.82, 170.39], frames(163.88, 177.88, PANEL_OUT, 4));
  compare("the Dialog's menu", [-10, -10.85, -12.58, -14.42, -16.04], frames(-10, -20, MENU_IN, 5));
  out.push(
    `the Sky cards' 50ms stagger: ${Math.round((STAGGER / 1000) * 60)} frames of a sixtieth, as the README says (3); ` +
      `card 2 starts at ${stagger.data.items[1]!.delay}ms, card 3 at ${stagger.data.items[2]!.delay}ms`,
  );
  out.push(
    `the panel's entry settles at ${settleFrame(149.88, 163.88, PANEL_IN)}ms, its exit at ` +
      `${settleFrame(163.88, 177.88, PANEL_OUT)}ms; the menu at ${settleFrame(-10, -20, MENU_IN)}ms`,
  );
  out.push(`the feed's fling lands on ${decay(FLING.start, FLING.velocity).project().toFixed(2)}px (sky.test.ts: 54.95)`);
  out.push(
    `the easing table: ${easingTable.data.rows.length} curves, ${easingTable.data.rows[0]!.label} at ` +
      `${easingTable.data.rows[0]!.progress.map((p) => `${p.toFixed(2)}%`).join(", ")} of its 0/25/50/75/100%`,
  );
  return out;
}

// The app's five points of a curve's duration, and the progress the solver makes at each: the easing table's data.
const POINTS = [0, 25, 50, 75, 100] as const;

/** A spring as the spec names it: `spatial` (which may overshoot) or `effect` (clamped, critically damped). */
function springClass(spring: Spring) {
  return spring.clamp
    ? { kind: "effect" as const, duration: Math.round(spring.duration * 1000) }
    : { kind: "spatial" as const, duration: Math.round(spring.duration * 1000), bounce: spring.bounce };
}

/** The progress a spring makes at a percent of its duration: `Track.at`'s x, from 0 to 100, in percent. */
function progressOf(spring: Spring, percent: number): number {
  const t = track(0, spring);
  t.target = 100;
  return value(t.at((spring.duration * percent) / 100).x);
}

const easingTable = {
  kind: "easingTable",
  title: "The app's easing curves",
  intent:
    "The springs the Dialog and the Sky page really run on, a row a curve: its class, its duration and bounce, and where " +
    "it is at 0, 25, 50, 75 and 100% of its duration — the solver's own numbers, so a curve's end is where its span " +
    "ends, not where it stops.",
  source: "solid/src/animations.ts's springs, sampled by solid/src/motion.ts",
  data: {
    rows: [
      ["the panel's entry", GROW],
      ["the menu's slide", SLIDE],
      ["the scrim's fade", OUT],
      ["the panel's exit", OUT_SLIDE],
      ["the card's entry", CARD_ENTRY_Y],
      ["the card's fade", CARD_ENTRY_A],
      ["a hover's fade", HOVER],
    ].map(([label, spring]) => ({
      label,
      motion: springClass(spring as Spring),
      progress: POINTS.map((point) => progressOf(spring as Spring, point)),
    })),
  },
};

const SPECS = [
  ["motion-timing.json", motionTiming],
  ["easing.json", easing],
  ["stagger.json", stagger],
  ["frame-strip.json", frameStrip],
  ["easing-table.json", easingTable],
] as const;

const here = dirname(fileURLToPath(import.meta.url));
const check = process.argv.includes("--check");
const out = check ? join(tmpdir(), "cssints-from-motion") : process.argv[2] ? resolve(process.argv[2]) : here;
mkdirSync(out, { recursive: true });
for (const [name, spec] of SPECS) writeFileSync(resolve(out, name), `${JSON.stringify(spec, null, 2)}\n`);

for (const line of recorded()) console.log(`from-motion: ${line}`);

if (check) {
  let drift = 0;
  for (const [name] of SPECS) {
    const cmp = spawnSync("cmp", [resolve(out, name), resolve(here, name)], { encoding: "utf8" });
    if (cmp.status !== 0) {
      drift++;
      console.error(`FAIL: solid/specs/${name} is not what specs/from-motion.ts writes: ${cmp.stderr.trim() || cmp.stdout.trim()}`);
    }
  }
  if (drift) process.exit(1);
  console.log(`from-motion: ${SPECS.length} specs, regenerated and cmp'd, byte for byte`);
} else {
  for (const [name] of SPECS) console.log(`from-motion: ${resolve(out, name)}`);
}
