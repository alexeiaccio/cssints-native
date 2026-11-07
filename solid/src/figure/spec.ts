// The figure spec, in the shape glyph-kit defines (skills/glyph-kit/reference/spec.md, MIT: the format, not its code):
// one JSON object per figure — `kind`, `title`, `intent`, `source`, `data`, `options`, `focus` — with 42 kinds here
// (`anatomy`, `appShell`, `barChart`, `beforeAfter`, `branchFlow`, `cardGrid`, `cohort`,
// `colourRoles`, `compare`, `contrast`, `easing`, `easingTable`, `flow`, `forecast`, `frameStrip`,
// `funnel`, `heatmap`, `intentCard`, `journeyMap`, `layerStack`, `listDetail`, `meter`, `modal`,
// `motionTiming`, `nowNextLater`, `palette`, `qaChecklist`, `redline`, `responsivePair`, `screen`,
// `spacingScale`, `sparkline`, `stagger`, `stateMachine`, `stateMatrix`, `statusKey`, `table`,
// `timeline`, `tokenTable`, `transitionSpec`, `tree`, `typeScale`).
// `check` returns **every** problem as a sentence, in
// the kit's voice, because a spec is refused before a frame is declared; `parse` is the same check over a file's text.
// No dependency: plain TypeScript over JSON.
//
// What is checked **here** is the spec as a whole, whatever its kind:
//   — a spec is one object whose `kind` this repository has; the sentence an unknown one is refused with is the
//     registry's own list, alphabetical (`unknown kind "pieChart": the ones here are barChart, compare, …`);
//   — numbers without a source ("These numbers need a source: where did they come from?");
//   — `options.width`, when a kind takes one: a whole number of cells above zero;
//   — a focus naming something the figure does not draw ("Focus names "M2", which isn't in the figure. Use a row label
//     or a column heading as it is drawn."), and a tone that is not one of the three;
//   — `sample`, which is `true` or absent: `true` draws the SAMPLE DATA stamp every layout puts above its title
//     (`./kinds/shared.ts`'s `finish`);
//   — `data: "@path"`, a file beside the spec, read and substituted by `parse` before `check` sees it (below).
//
// A kind's own data rule — the funnel's "a funnel never grows", a branch's `no`, the path's transitions, the tree's one
// root, a journey's range, the palette's direction, a pair's ratio against its own colours, a scale that grows, an
// anatomy's callouts — is in the file that draws it, beside its layout: `./kinds/metrics.ts`, `./kinds/flows.ts`,
// `./kinds/structure.ts`, `./kinds/systems.ts`, `./kinds/handoff.ts`, `./kinds/motion.ts`, `./kinds/planning.ts`,
// `./kinds/charts.ts` and `./kinds/wireframe.ts`, reached through `./registry.ts` (`./kinds.ts` is the door and loads
// all nine). One file to a kind's area is what makes the next kind cheap: a layout, a check and one `register`, and no
// other kind's file is opened. So a sentence here that is about one kind's data belongs there, and a sentence about
// every spec stays here.
//
// The contrast pair's `ratio` is a number in the data, and it is the **engine's** — packages/cssints/src/color.ts's
// `luminance`/`ratio`, which `solid/specs/from-tokens.ts` writes the spec with. The contrast kind's own check recomputes
// it through ./contrast.ts (WCAG's formula, no dependency: see its header for why a copy is here and how figure.test.ts
// holds it to the engine).

// the kinds' own layouts and checks: importing the door registers every area (see the header)
import "./kinds.ts";

import { isObject, labelOf, number, rowsOf, say } from "./kinds/shared.ts";
import { checkOf, entryOf, kinds, namesOf } from "./registry.ts";

// The kinds' **types**: these are the forty-two this repository draws. The runtime list is the registry's (`kinds()` in
// ./registry.ts, alphabetical), and figure-registry.test.ts holds this list, the registry and native/docs/map.md
// together — so a kind added here without its area file fails there. The kit's own types that are still not drawn are
// named in native/README.md's "Not here", with the reason each waits.
export const KINDS = [
  "anatomy",
  "appShell",
  "barChart",
  "beforeAfter",
  "branchFlow",
  "cardGrid",
  "cohort",
  "colourRoles",
  "compare",
  "contrast",
  "easing",
  "easingTable",
  "flow",
  "forecast",
  "frameStrip",
  "funnel",
  "heatmap",
  "intentCard",
  "journeyMap",
  "layerStack",
  "listDetail",
  "meter",
  "modal",
  "motionTiming",
  "nowNextLater",
  "palette",
  "qaChecklist",
  "redline",
  "responsivePair",
  "screen",
  "spacingScale",
  "sparkline",
  "stagger",
  "stateMachine",
  "stateMatrix",
  "statusKey",
  "table",
  "timeline",
  "tokenTable",
  "transitionSpec",
  "tree",
  "typeScale",
];

/** The three tones of a focus: the role the figure paints it by, never a colour. */
export const TONES = ["problem", "good", "plain"] as const;
export type Tone = (typeof TONES)[number];

/** What the figure wants a reader to look at; `on` names things as they are drawn. */
export interface Focus {
  on: string | readonly string[];
  tone?: Tone;
  say?: string;
}

export interface BarRow {
  label: string;
  value: number;
  /** The number as it should read; absent, the value is formatted (with "+" past `options.max`). */
  text?: string;
}

export interface CompareRow {
  label: string;
  a: number;
  aText?: string;
  b: number;
  bText?: string;
}

interface Base {
  title?: string;
  intent?: string;
  /** Where the numbers came from: required whenever the data holds one. */
  source?: string;
  focus?: Focus;
  /** `true` when the data is a sample and not this repository's own: the figure then stamps itself SAMPLE DATA. */
  sample?: true;
}

export interface BarChartSpec extends Base {
  kind: "barChart";
  data: readonly BarRow[];
  options?: { width?: number; max?: number };
}

export interface CompareSpec extends Base {
  kind: "compare";
  data: readonly CompareRow[];
  options?: { width?: number; headers?: readonly string[] };
}

export interface FlowSpec extends Base {
  kind: "flow";
  data: readonly string[];
  options?: { width?: number };
}

export interface FunnelSpec extends Base {
  kind: "funnel";
  data: readonly BarRow[];
  options?: { width?: number };
}

/** A decision's branch: the box drawn to its right, and the step (or "end") it goes to next. */
export interface Branch {
  label: string;
  /** A step's label in the same list, or "end" to finish the flow there. */
  to: string;
}

/** A step of a branch flow: a plain `{ label }`, or a decision with its `no` branch. */
export interface BranchStep {
  label: string;
  type?: "decision";
  no?: Branch;
}

export interface BranchFlowSpec extends Base {
  kind: "branchFlow";
  data: readonly BranchStep[];
  options?: { width?: number };
}

/** One transition: a state, the state it goes to, and the event (`on`) that takes it there. */
export interface Transition {
  from: string;
  to: string;
  on: string;
}

export interface StateMachineData {
  states: readonly string[];
  transitions: readonly Transition[];
}

export interface StateMachineSpec extends Base {
  kind: "stateMachine";
  data: StateMachineData;
  /** `path` is the walk the figure draws, one state a box; it must start at `states[0]`. */
  options?: { width?: number; path?: readonly string[] };
}

/** One stage of a journey: what people did, what they thought, and how it felt (-2 bad to 2 great, the kit's scale). */
export interface Stage {
  label: string;
  doing?: string;
  thinking?: string;
  feeling: number;
}

export interface JourneyMapSpec extends Base {
  kind: "journeyMap";
  data: readonly Stage[];
  /** `width` is the feeling bar's track, in cells. */
  options?: { width?: number };
}

/** A node of a tree: glyph-kit's nested shape, or a name and its parent's name in a flat list. */
export interface TreeNode {
  name: string;
  children?: readonly TreeNode[];
  /** The flat list's link upward: a node without one is the root. */
  parent?: string;
}

export interface TreeSpec extends Base {
  kind: "tree";
  /** glyph-kit's nested `{ name, children }`, or a parent/child list with one node above the rest. */
  data: TreeNode | readonly TreeNode[];
  options?: { width?: number };
}

/** One step of a hue: the name a scale gives it (`50`, `1`, `0`) and its colour. */
export interface PaletteStep {
  name: string;
  /** `#rrggbb`, the palette's own data — a swatch is the one thing a figure draws as itself. */
  value: string;
}

/** A hue and its steps, from the lightest to the darkest (or the other way: a scale holds one direction). */
export interface PaletteHue {
  name: string;
  steps: readonly PaletteStep[];
}

/** glyph-kit's palette: the hues, each a tonal scale, against the page they are read on. */
export interface PaletteData {
  /** The page the steps are measured on; `#ffffff` when the data does not say. */
  page?: string;
  hues: readonly PaletteHue[];
}

export interface PaletteSpec extends Base {
  kind: "palette";
  data: PaletteData;
}

/**
 * One pair of the colour roles: the text's colour, the page under it, the WCAG floor it is held to, and the ratio of the
 * two, to two places. `ratio` is the engine's number (packages/cssints/src/color.ts), written by
 * `solid/specs/from-tokens.ts`; `check` recomputes it and refuses a pair whose colours do not make it.
 */
export interface ContrastPair {
  label: string;
  fg: string;
  bg: string;
  /** 3, 4.5 or 7: WCAG's three floors (graphics, body text, AAA). */
  min: number;
  ratio: number;
}

export interface ContrastSpec extends Base {
  kind: "contrast";
  data: readonly ContrastPair[];
}

/** One series: a label, its points, and the unit a point's number reads in (`ms`). */
export interface SparklineData {
  label: string;
  values: readonly number[];
  unit?: string;
}

export interface SparklineSpec extends Base {
  kind: "sparkline";
  data: SparklineData;
}

/**
 * One value against its range and a floor: a contrast ratio (the engine's, from `fg` on `bg`) held to WCAG's floor
 * `min`, in a range whose top is `max` (21 by default, WCAG's end).
 */
export interface MeterData {
  label: string;
  fg: string;
  bg: string;
  /** The floor the value is held to: 3, 4.5 or 7, WCAG's three floors. */
  min: number;
  /** The engine's ratio of `fg` on `bg`; `check` refuses a value its colours do not make. */
  value: number;
  /** The range's top; absent, 21. */
  max?: number;
}

export interface MeterSpec extends Base {
  kind: "meter";
  data: MeterData;
}

/** One ink of a heatmap: its name and the `#rrggbb` it is. */
export interface HeatmapRow {
  label: string;
  fg: string;
}

/** One page a heatmap's inks are read on: its name and the `#rrggbb` it is. */
export interface HeatmapColumn {
  label: string;
  bg: string;
}

/** A matrix of contrast ratios: a row an ink, a column a page, `values[row][column]` their engine ratio. */
export interface HeatmapData {
  rows: readonly HeatmapRow[];
  columns: readonly HeatmapColumn[];
  values: readonly (readonly number[])[];
}

/** One minute's cohort: its label, the accounts that posted in it, and the share seen again at each lag. */
export interface CohortRow {
  /** The minute of the window, `"0m"`, `"1m"`, … — a grid's rows run forward. */
  label: string;
  /** The accounts that posted in that minute: the denominator of every share in the row. */
  size: number;
  /** One whole percent per lag: the share of `size` that posted again `lag` minutes later. */
  values: readonly number[];
}

/** The firehose's retention: a window in minutes, the lags a row is measured at, and a row a minute. */
export interface CohortData {
  /** The recording's length, in whole minutes: a cohort's last lag has to land inside it. */
  window: number;
  lags: readonly number[];
  cohorts: readonly CohortRow[];
}

export interface CohortSpec extends Base {
  kind: "cohort";
  data: CohortData;
}

export interface HeatmapSpec extends Base {
  kind: "heatmap";
  data: HeatmapData;
}

/** One day of a forecast's series: its date and the count that day (a quiet day is a zero, not a missing day). */
export interface ForecastDay {
  /** `YYYY-MM-DD`: the days sort as they read, so a series is increasing when its dates are. */
  date: string;
  value: number;
}

/** One projected day: the date, the model's count a day, and the band the window's spread puts around it. */
export interface ForecastDayAhead extends ForecastDay {
  /** The band's bottom: `mean - sd`, clamped at zero, because a count cannot be negative. */
  low: number;
  /** The band's top: `mean + sd`. */
  high: number;
}

/**
 * A dated series and the next days a model projects: the days that happened, a day a count, then the days ahead at one
 * count a day with a band. The data is `solid/specs/from-releases.ts`'s (this repository's own `CHANGELOG.md`), so the
 * window, the mean and the sd are the generator's arithmetic and the figure only draws them.
 */
export interface ForecastSpec extends Base {
  kind: "forecast";
  data: {
    samples: readonly ForecastDay[];
    /** The days ahead, in date order after the last sample; the figure draws them to the right of a one-cell gap. */
    projection: readonly ForecastDayAhead[];
    /** How many days ahead the model looks: a whole number above zero. */
    horizon: number;
    /** The window the fit is over, in days: the trailing fortnight here. */
    window: number;
    /** The fit's mean count a day, over that window. */
    mean: number;
    /** The window's population standard deviation: the band is `mean ± 1 sd`. */
    sd: number;
    /** The model in a sentence: which window, which fit, clamped at zero. A forecast without one is refused. */
    model: string;
  };
}

/** One step of a spacing scale: its token's name and its length in pixels. */
export interface SpacingStep {
  name: string;
  value: number;
}

export interface SpacingSpec extends Base {
  kind: "spacingScale";
  data: readonly SpacingStep[];
}

/** One step of a type scale: its token's name, its size and its line height, in pixels. */
export interface TypeStep {
  name: string;
  size: number;
  lineHeight: number;
}

export interface TypeScaleSpec extends Base {
  kind: "typeScale";
  data: readonly TypeStep[];
}

/** One role's value in one mode: its foreground and background colours and the ratio they make, which is the engine's. */
export interface RolePair {
  fg: string;
  bg: string;
  ratio: number;
}

/** A role pair's two modes, the WCAG floor it is held to, and what it is for. */
export interface ColourRole {
  label: string;
  min: number;
  light: RolePair;
  dark: RolePair;
}

export interface ColourRolesSpec extends Base {
  kind: "colourRoles";
  data: readonly ColourRole[];
}

/** A layer's shadow: its offset and its blur, in pixels, as the frame's effect table gives them. */
export interface LayerShadow {
  x: number;
  y: number;
  blur: number;
}

/**
 * One layer of a stack, back to front: the page, then whatever floats over it. The numbers are the frame's own — the
 * command's box, its fill's alpha and corner radius, and the effect tables' blur and shadow — so a layer stack is the
 * page's overlays measured, not a z scale typed into a spec.
 */
export interface Layer {
  name: string;
  /** The stacking order: a layer after another one does not sit below it. */
  z: number;
  box: { width: number; height: number };
  /** The layer's fill alpha, 0 to 1 (a scrim's 0.55, an opaque surface's 1). */
  alpha: number;
  /** The corner radius, in pixels: 0 for a rectangle. */
  radius: number;
  /** A backdrop's blur, in pixels, when the layer blurs what is behind it. */
  blur?: number;
  shadow?: LayerShadow;
}

export interface LayerStackSpec extends Base {
  kind: "layerStack";
  data: readonly Layer[];
}

/** One row of a state matrix: a style, and the columns it declares a state for. */
export interface StateMatrixRow {
  name: string;
  states: readonly string[];
}

/**
 * A matrix of styles against states: the columns are the states a page's styles can declare (`hover`, `focus`, `active`),
 * the rows are the styles, and a cell is whether that style has that state. The data is generated from the pages' own
 * style modules (`solid/specs/from-styles.ts`), so a state added to a style is the figure's next row, not a typo.
 */
export interface StateMatrixData {
  columns: readonly string[];
  rows: readonly StateMatrixRow[];
}

export interface StateMatrixSpec extends Base {
  kind: "stateMatrix";
  data: StateMatrixData;
}

/** One token of a token table: its group, its name in that group, and its value as the token file resolves it. */
export interface TokenRow {
  group: string;
  name: string;
  value: string;
}

export interface TokenTableSpec extends Base {
  kind: "tokenTable";
  data: readonly TokenRow[];
}

/** A table's column: the heading it is drawn with, and how its cells read inside the column's width. */
export interface TableColumn {
  title: string;
  /** "left" (the default), or "right": a number's column reads flush right, as a number does. */
  align?: "left" | "right";
}

/**
 * A table: columns and rows of text, drawn on the cell grid — the header once, a rule under it, a cell cut to its
 * column's width with `…`. The cells are strings and nothing else: what a table says is what its source says.
 */
export interface TableData {
  columns: readonly TableColumn[];
  /** A row a list of cells, one the column beside it; every row has one cell a column. */
  rows: readonly (readonly string[])[];
  /** A rule of `-` between the header and the body; drawn unless the data says false. */
  headerRule?: boolean;
}

export interface TableSpec extends Base {
  kind: "table";
  data: TableData;
  /** `max` caps a column's width in cells: a value wider than its column is cut with `…`, counted in cells. */
  options?: { max?: number };
}

/** One part of a redline: a rectangle inside the component's box, in pixels, measured from the box's top-left corner. */
export interface RedlinePart {
  label: string;
  /** The part's left inset from the box's left edge, in pixels. */
  x: number;
  /** The part's top inset from the box's top edge, in pixels. */
  y: number;
  width: number;
  height: number;
  /** A padding or a gap: the space between two parts, drawn as a dotted leader and counted in the row like a part. */
  inset?: boolean;
}

/** A redline: the component's box (`width` x `height`) and the parts inside it, in the order they tile its width. */
export interface RedlineData {
  box: { label: string; width: number; height: number };
  parts: readonly RedlinePart[];
}

export interface RedlineSpec extends Base {
  kind: "redline";
  data: RedlineData;
}

/** One measure of a before/after state: what it is, and how it reads (`"the track"`, `"60,64,78"`). */
export interface Measure {
  label: string;
  value: string;
}

/** One state of a before/after: its caption, its box, and the measures the two states share. */
export interface BeforeAfterState {
  caption: string;
  box: { width: number; height: number };
  measures: readonly Measure[];
}

/** The two states of one component, measured the same way; the numbers that differ are the figure's. */
export interface BeforeAfterData {
  before: BeforeAfterState;
  after: BeforeAfterState;
}

export interface BeforeAfterSpec extends Base {
  kind: "beforeAfter";
  data: BeforeAfterData;
}

/** A checklist's verdict, the three the key names. */
export const VERDICTS = ["pass", "fail", "n/a"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** One comparison of a checklist: what it checks, the suite's area, its verdict, and the script that prints it. */
export interface ChecklistRow {
  check: string;
  area: string;
  verdict: Verdict;
  /** The script that prints the comparison, like `native/solid/test.sh`. */
  source: string;
}

/** A checklist: the rows and the summary `"<pass> of <rows> pass"`, which `check` holds to the rows. */
export interface ChecklistData {
  summary: string;
  rows: readonly ChecklistRow[];
}

export interface QaChecklistSpec extends Base {
  kind: "qaChecklist";
  data: ChecklistData;
}

/**
 * What a motion is, in the terms `solid/src/motion.ts` takes: a spring's class and its `(duration, bounce)` in
 * milliseconds, or a fling's velocity in px/s. The spec stores milliseconds because a figure's rows are read in them;
 * the solver is handed seconds (its own unit).
 */
export type MotionClass =
  | { readonly kind: "spatial"; readonly duration: number; readonly bounce: number }
  | { readonly kind: "effect"; readonly duration: number }
  | { readonly kind: "decay"; readonly velocity: number };

/** One instant of a track: when (`ms` from its start) and where (`Track.at`'s x, in px). */
export interface MotionSample {
  readonly ms: number;
  readonly value: number;
}

/** One track of a `motionTiming` figure: its spring, its range and the samples it takes. */
export interface MotionTrack {
  readonly label: string;
  readonly start: number;
  readonly target: number;
  readonly motion: MotionClass;
  readonly samples: readonly MotionSample[];
}

export interface MotionTimingSpec extends Base {
  kind: "motionTiming";
  data: { readonly tracks: readonly MotionTrack[] };
  options?: { readonly width?: number };
}

/** One curve of an `easing` figure: a spring reaching the same target, sampled. */
export interface EasingCurve {
  readonly label: string;
  readonly start: number;
  readonly target: number;
  readonly motion: MotionClass;
  readonly samples: readonly MotionSample[];
}

export interface EasingSpec extends Base {
  kind: "easing";
  data: { readonly curves: readonly EasingCurve[] };
  options?: { readonly width?: number; readonly rows?: number };
}

/** One element of a stagger: the delay before it starts and how long it takes, in ms. */
export interface StaggerItem {
  readonly label: string;
  readonly delay: number;
  readonly duration: number;
}

export interface StaggerSpec extends Base {
  kind: "stagger";
  data: { readonly items: readonly StaggerItem[] };
  options?: { readonly width?: number };
}

/** One frame of a strip: the instant and the box's position, in px. */
export interface StripFrame {
  readonly ms: number;
  readonly value: number;
}

/** One strip of a `frameStrip` figure: the motion and the frames it is shown at. A spring's range ends at `target`; a
 *  fling's at `decay(...).project()`, which is why `target` is absent for one. */
export interface FrameStrip {
  readonly label: string;
  readonly start: number;
  readonly target?: number;
  readonly motion: MotionClass;
  readonly frames: readonly StripFrame[];
}

export interface FrameStripSpec extends Base {
  kind: "frameStrip";
  data: { readonly strips: readonly FrameStrip[] };
  options?: { readonly width?: number };
}

/** One property an animation changes: its name, the two values it runs between, and the unit those values read in. */
export interface CardProperty {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  /** `"of 255"`, `"px"`, `"%"`, `"deg"`: what the numbers mean, printed beside them. */
  readonly unit: string;
}

/** One recorded frame of a card: the instant it was taken at, and a value for each of the card's properties. */
export interface CardFrame {
  readonly ms: number;
  readonly values: readonly number[];
}

/**
 * One animation as a card: what it is for, the `@cssints/motion` preset whose fields are the ones it changes, the page
 * it runs on and the trigger it answers, its duration and delay, the properties and the values they run between, and the
 * frames it actually took. `solid/specs/from-frames.ts` writes it from the page's own frames, so the numbers are the
 * page's.
 */
export interface IntentCardData {
  /** What animates: `the feed's third card`. */
  readonly label: string;
  /** The page it runs on, as `native/solid/app` names it: `Sky`. */
  readonly page: string;
  /** What starts it: `the feed's first mount`. */
  readonly trigger: string;
  /** The preset's name, from `@cssints/motion`'s table: the fields it sets are the properties this card changes. */
  readonly preset: string;
  /** The animation's duration, in ms. */
  readonly duration: number;
  /** What it waits before it starts, in ms. */
  readonly delay: number;
  readonly properties: readonly CardProperty[];
  readonly frames: readonly CardFrame[];
}

export interface IntentCardSpec extends Base {
  kind: "intentCard";
  data: IntentCardData;
}

/** One property a transition moves: the same two numbers a card's property has, so a figure reads the same either way. */
export type TransitionProperty = CardProperty;

/** The two boxes one transition moves between: the animating element's own box at the start and at the end. */
export interface TransitionBoxes {
  readonly from: WireBox;
  readonly to: WireBox;
}

/**
 * One transition, before and after: the recorded scene it was taken from, what triggers it, the element's box in each
 * frame, the properties that move (with the two values each runs between), and the duration and delay of the motion that
 * moves them. `solid/specs/from-frames.ts` writes it from two captured frames of `solid/scenes/*.json`, so the boxes and
 * the properties are the frames', and the duration is the page's own spring.
 */
export interface TransitionSpecData extends TransitionBoxes {
  /** What moves: `the menu`. */
  readonly label: string;
  /** The page it runs on: `dialog`. */
  readonly page: string;
  /** The recorded scene the frames were taken from: `dialog-menu`. */
  readonly scene: string;
  /** What starts it: `Enter on the Zoom control`. */
  readonly trigger: string;
  readonly properties: readonly TransitionProperty[];
  /** The motion's duration, in ms: the longest track driving the properties. */
  readonly duration: number;
  readonly delay: number;
}

export interface TransitionSpecSpec extends Base {
  kind: "transitionSpec";
  data: TransitionSpecData;
}

/** One row of an easing table: a curve as the app uses it, and the progress it makes at five points of its duration. */
export interface EasingRow {
  /** Where the curve is used, as the app names it: `the panel's entry`. */
  readonly label: string;
  readonly motion: MotionClass;
  /** The progress at 0, 25, 50, 75 and 100% of the duration, in percent of the travel. */
  readonly progress: readonly number[];
}

/**
 * The app's easing curves in one table: a row a curve, its class, its duration and bounce, and its progress at 0, 25, 50,
 * 75 and 100% of the duration — `solid/specs/from-motion.ts` calls `solid/src/motion.ts`'s own solver at those instants,
 * so a row is the model's, not a table of numbers.
 */
export interface EasingTableSpec extends Base {
  kind: "easingTable";
  data: { readonly rows: readonly EasingRow[] };
}

/** One row of a timeline: its label, the span it covers on the shared axis, and what the source recorded of it. */
export interface TimelineEntry {
  label: string;
  /** The span's start on the axis's own unit (a step of the plan here, not hours). */
  start: number;
  /** The span's end: after `start`, or the row is refused. */
  end: number;
  /** The status a planning figure gives it (`Done`, `Left`, `Blocked`), for the status key's role. */
  status?: string;
  /** A recorded date that is an axis of its own: a row's may not come before the row above it. */
  date?: string;
  /** A recorded note that is not an axis (a date the source mentions): printed after the span. */
  note?: string;
  tone?: Tone;
}

export interface TimelineSpec extends Base {
  kind: "timeline";
  data: readonly TimelineEntry[];
  /** `width` is the shared axis in cells; `start`, `end` and `unit` label its two ends. */
  options?: { width?: number; start?: number; end?: number; unit?: string };
}

/** One status of a key: glyph-kit's `label`, and the sentence that says what the status means here. */
export interface StatusEntry {
  label: string;
  sentence: string;
  tone?: Tone;
}

export interface StatusKeySpec extends Base {
  kind: "statusKey";
  data: readonly StatusEntry[];
  /** `used` is the declared set of statuses the planning figures here draw; a key may name no other. */
  options?: { used?: readonly string[] };
}

/** glyph-kit's `board`: three columns of cards, a card a string. */
export interface BoardData {
  now: readonly string[];
  next: readonly string[];
  later: readonly string[];
}

export interface NowNextLaterSpec extends Base {
  kind: "nowNextLater";
  data: BoardData;
}

/**
 * One box of a captured page, in pixels from its top-left corner: the `box` of a `rectangle` or a `border` command.
 * The data is the frame itself, not a drawing of it, so a wireframe cannot drift from the page it names.
 */
export interface WireBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One text run of a captured page: where its command starts and the string it draws, in the page's own order. */
export interface WireText {
  x: number;
  y: number;
  text: string;
}

/** One page's frame as a spec's data: the page's size and the boxes and texts its last frame carries. */
export interface WireSide {
  width: number;
  height: number;
  boxes: readonly WireBox[];
  texts: readonly WireText[];
}

/** A wireframe of one page this repository draws: its name, its size, and its own frame. */
export interface ScreenData extends WireSide {
  page: string;
}

export interface ScreenSpec extends Base {
  kind: "screen";
  data: ScreenData;
  /** `width` is the layout's widest allowed cells; a page wider than this is refused. */
  options?: { width?: number };
}

/** The same page at two widths, each its own captured frame: `narrow` is the narrower of the two. */
export interface ResponsivePairData {
  page: string;
  narrow: WireSide;
  wide: WireSide;
}

export interface ResponsivePairSpec extends Base {
  kind: "responsivePair";
  data: ResponsivePairData;
  options?: { width?: number };
}

/** The region of a page an anatomy draws, in the page's own pixels. */
export interface AnatomyCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One numbered part of a component drawing: the digit's point in the page's pixels, and what it names. */
export interface AnatomyPart {
  n: number;
  x: number;
  y: number;
  label: string;
}

/** A component drawing: a page's own frame cut to one region, with numbered callouts and their legend. */
export interface AnatomyData extends WireSide {
  page: string;
  /** The region drawn; absent, the whole page. */
  crop?: AnatomyCrop;
  parts: readonly AnatomyPart[];
}

export interface AnatomySpec extends Base {
  kind: "anatomy";
  data: AnatomyData;
  options?: { width?: number };
}

/** The Dialog's modal, open: its frame, the keys it was taken with, and the panel the modal is. */
export interface ModalData extends WireSide {
  page: string;
  /** The keys the frame is taken with (`Tab, Enter`: the "Settings" control, then the open). */
  keys: readonly string[];
  /** Frames at rest after them, so the panel's entry is over and the frame is the modal, not its animation. */
  settle: number;
  /** The dialog's own box, in the page's pixels: what makes the frame this modal's. */
  panel: WireBox;
}

export interface ModalSpec extends Base {
  kind: "modal";
  data: ModalData;
  options?: { width?: number };
}

/**
 * One band of a page's own shell: the element the capture drew (`sky-bar`) and the part of the shell it is (`nav`). The
 * box is that element's own rect, so a band that is not an element of the page is not a band.
 */
export interface ShellRegion {
  /** The part of the shell the band is: `nav`, `content`, `status`. The author's word, not a drawn one. */
  band: string;
  /** The page's id of the element the frame drew, like `sky-bar`. */
  element: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A page's shell: the bands its own frame drew, and that frame beside them. */
export interface AppShellData extends WireSide {
  page: string;
  regions: readonly ShellRegion[];
}

export interface AppShellSpec extends Base {
  kind: "appShell";
  data: AppShellData;
  /** `width` is the layout's widest allowed cells; a page wider than this is refused. */
  options?: { width?: number };
}

/** One card of a page's repeated grid: its place in the page's own order and the box its element drew. */
export interface GridCard {
  /** The page's index of the card (`sky-card-2` is 2). */
  index: number;
  /** The page's id of the element the frame drew, like `sky-card-0`. */
  element: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A page's repeated cards, and the grid their boxes make: how many columns, and the gaps between them. */
export interface CardGridData extends WireSide {
  page: string;
  /** The element-name prefix every card shares (`sky-card-`): a card is an element, not a box that happens to repeat. */
  prefix: string;
  cards: readonly GridCard[];
  /** The columns the cards' x positions make (`gridOf` in kinds/wireframe.ts derives all three from the boxes). */
  columns: number;
  /** The gap between two cards down a column, in pixels. */
  gap: number;
  /** The gap between two columns, in pixels: 0 when the grid has one. */
  columnGap: number;
}

export interface CardGridSpec extends Base {
  kind: "cardGrid";
  data: CardGridData;
  options?: { width?: number };
}

/**
 * One pane of a list/detail page: the page's own element for it (`sky-feed-pane`) and that element's box. A pane is not a
 * rectangle an author drew — `check` looks it up in the frame's own boxes.
 */
export interface ListPane {
  element: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A page as two panes: the list and the detail. Each is an element the frame drew, and the two tile the page. */
export interface ListDetailData extends WireSide {
  page: string;
  list: ListPane;
  detail: ListPane;
}

export interface ListDetailSpec extends Base {
  kind: "listDetail";
  data: ListDetailData;
  /** `width` is the layout's widest allowed cells; a page wider than this is refused. */
  options?: { width?: number };
}

export type Spec =
  | AnatomySpec
  | AppShellSpec
  | BarChartSpec
  | BeforeAfterSpec
  | BranchFlowSpec
  | CardGridSpec
  | CohortSpec
  | ColourRolesSpec
  | CompareSpec
  | ContrastSpec
  | FlowSpec
  | ForecastSpec
  | FunnelSpec
  | HeatmapSpec
  | JourneyMapSpec
  | LayerStackSpec
  | ListDetailSpec
  | ModalSpec
  | StateMatrixSpec
  | TokenTableSpec
  | MeterSpec
  | NowNextLaterSpec
  | PaletteSpec
  | QaChecklistSpec
  | RedlineSpec
  | ResponsivePairSpec
  | ScreenSpec
  | SpacingSpec
  | SparklineSpec
  | StateMachineSpec
  | StatusKeySpec
  | TableSpec
  | TimelineSpec
  | TreeSpec
  | TypeScaleSpec
  | EasingSpec
  | EasingTableSpec
  | FrameStripSpec
  | IntentCardSpec
  | MotionTimingSpec
  | StaggerSpec
  | TransitionSpecSpec;

/** Does the data hold a number anywhere? A spec with numbers needs a source, as the kit's guard refuses without one. */
function hasNumbers(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.some(hasNumbers);
  if (isObject(value)) return Object.values(value).some(hasNumbers);
  return false;
}
const widthProblem = (options: unknown): string[] => {
  const width = isObject(options) ? options.width : undefined;
  if (width === undefined) return [];
  const n = number(width);
  return n !== undefined && Number.isInteger(n) && n > 0
    ? []
    : [`options.width must be a whole number of cells above zero: it is ${say(width)}.`];
};

/** The kit's focus checks: `on` is required, a tone is one of three, and every name is drawn. */
function focusProblems(focus: unknown, names: readonly string[]): string[] {
  if (focus === undefined || focus === null) return [];
  if (!isObject(focus)) return ['Write focus as { "on": ["a label or heading"], "tone": "problem", "say": "what to see" }.'];
  const raw = focus.on;
  const on =
    typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  const out: string[] = [];
  if (!on.length) out.push('Focus needs "on": the row labels or column headings to look at, as they are drawn.');
  if (focus.tone !== undefined && !(TONES as readonly unknown[]).includes(focus.tone))
    out.push(`Focus tone is problem, good or plain, not ${say(focus.tone)}.`);
  const missing = on.filter((name) => !names.includes(name));
  if (missing.length)
    out.push(
      `Focus names ${missing.map((m) => `"${m}"`).join(", ")}, which ${missing.length === 1 ? "isn't" : "aren't"} in ` +
        `the figure. Use a row label or a column heading as it is drawn.`,
    );
  return out;
}

/**
 * Every problem with a spec, in plain sentences: the kind, the numbers' source, the kind's own data rule (which its area
 * file checks), the focus's names, and a `sample` that is not `true`. An empty array is a figure that can be drawn.
 */
export function check(input: unknown): string[] {
  if (!isObject(input))
    return ['A spec is one JSON object: kind, data, and a source when there are numbers on the figure.'];
  const kind = input.kind;
  if (typeof kind !== "string" || !entryOf(kind))
    return [`unknown kind ${say(kind)}: the ones here are ${kinds().join(", ")}.`];
  const problems: string[] = [];
  if (input.sample !== undefined && input.sample !== true)
    problems.push(`sample is true when the data is not the author's, and absent when it is: it is ${say(input.sample)}.`);
  if (hasNumbers(input.data) && !String(input.source ?? "").trim())
    problems.push("These numbers need a source: where did they come from?");
  problems.push(...widthProblem(input.options));
  problems.push(...checkOf(kind, input.data, input.options));
  // a kind's own names when the data's row labels are not what a focus may point at; its rows otherwise
  const names = namesOf(kind, input.data, input.options) ?? rowsOf(input.data).map((row, i) => labelOf(row, i));
  problems.push(...focusProblems(input.focus, names));
  return problems;
}

/** What `parse` needs beyond the file's text: where the file sits, when its `data` is `"@path"`. */
export interface ParseOptions {
  /** The spec file's own directory: a `data: "@path"` is read relative to it. Absent, only inline data parses. */
  readonly dir?: string;
}

/** One `node:fs` read, found lazily: a browser bundle of this module carries no `node:` import. */
type ReadFile = (path: string) => string;
function readFile(): ReadFile | undefined {
  const host = (globalThis as unknown as { process?: { getBuiltinModule?: (name: string) => unknown } }).process;
  const fs = host?.getBuiltinModule?.("node:fs") as
    | { readFileSync?: (path: string, encoding: "utf8") => string }
    | undefined;
  if (!fs?.readFileSync) return undefined;
  const read = fs.readFileSync.bind(fs);
  return (path) => read(path, "utf8");
}

/** Is this the root of a path, on either convention? A data path is a file beside the spec, never the root. */
const absolute = (path: string): boolean => /^(?:\/|\\|[A-Za-z]:[\\/])/.test(path);

/** Does this path climb above the directory it is relative to? `a/../b` does not; `../b` and `a/../../b` do. */
function climbs(path: string): boolean {
  let depth = 0;
  for (const segment of path.split(/[\\/]/)) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      depth -= 1;
      if (depth < 0) return true;
    } else depth += 1;
  }
  return false;
}

/**
 * A spec's `data: "@path"` as the JSON it names: the file **beside the spec**, read and substituted before `check` sees
 * the data, so a kind only ever checks an object or an array. The refusals are the path's own: an absolute path, one that
 * leaves the spec's directory, a file that is not there, and one that is not JSON.
 */
function inlineData(input: Record<string, unknown>, dir: string | undefined): string[] {
  const data = input.data;
  if (typeof data !== "string" || !data.startsWith("@")) return [];
  if (dir === undefined)
    return ['A spec whose data is "@…" needs the file it sits in: parse() was given no path.'];
  const relative = data.slice(1);
  if (absolute(relative))
    return [`data ${say(data)} is absolute: write the path relative to the spec's own directory.`];
  if (climbs(relative))
    return [`data ${say(data)} leaves the spec's directory: a data path goes no higher.`];
  const read = readFile();
  if (!read)
    return ['A spec whose data is "@…" needs the file it sits in: only a host with files can resolve it.'];
  const path = `${dir.replace(/[\\/]+$/, "")}/${relative}`;
  let text: string;
  try {
    text = read(path);
  } catch {
    return [`data ${say(data)} names no file beside the spec.`];
  }
  try {
    input.data = JSON.parse(text);
  } catch (error) {
    return [
      `data ${say(data)} is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  return [];
}

/**
 * A spec file's text as a checked spec, or the sentences that refuse it. `options.dir` is the file's own directory, which
 * a `data: "@path"` is read relative to; a spec with inline data parses as it always has.
 */
export function parse(text: string, options: ParseOptions = {}): { spec?: Spec; problems: string[] } {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (error) {
    return { problems: [`This spec is not JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
  if (isObject(input)) {
    const dataProblems = inlineData(input, options.dir);
    if (dataProblems.length) return { problems: dataProblems };
  }
  const problems = check(input);
  return problems.length ? { problems } : { spec: input as unknown as Spec, problems };
}