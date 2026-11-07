// The door to a figure's kinds: the types, the cell constants and the registry, and the one place the areas are loaded.
//
// A kind lives in **one file** of `./kinds/`, its layout and its own refusals side by side:
//
//   kinds/metrics.ts    barChart, compare, contrast, funnel
//   kinds/flows.ts      flow, branchFlow, stateMachine
//   kinds/structure.ts  journeyMap, tree
//   kinds/systems.ts    palette, spacingScale, typeScale, table
//   kinds/planning.ts   timeline, statusKey, nowNextLater
//   kinds/charts.ts     sparkline, meter, heatmap
//   kinds/handoff.ts    beforeAfter, qaChecklist, redline
//   kinds/motion.ts     easing, frameStrip, motionTiming, stagger
//   kinds/wireframe.ts  screen, anatomy, appShell, cardGrid, modal, responsivePair (a page's own frame, cut to cells)
//   kinds/shared.ts     what they all use — cells, the item builders, `finish`, the raw-JSON readers — and no kind
//
// To add a kind, three steps, none of them in another kind's file:
//   1. `spec.ts`: its spec type in `Spec` and its name in `KINDS` (the type-level list: a union cannot be built by a call,
//      and a spec's `kind` is a literal);
//   2. its area file: the layout function and the check, beside that area's others, and one
//      `register("<kind>", { layout, check })` at the bottom — plus a `names` when its focus may point at something that
//      is not a row label;
//   3. a spec in `solid/specs`, when the repository draws one.
// Nothing else changes. `Figure.tsx`, `text.ts`, the terminal host and the browser draw whatever `layoutOf` returns for a
// spec's `kind`; `spec.ts`'s whole-spec checks (a source, a focus's names, the width) and `figure-registry.test.ts` cover
// the rest, the test being the one place a kind is asked for both halves and the list the docs print.
//
// `spec.ts` imports this file for the areas' registration, so a check read on its own — the CLI, a terminal, a browser —
// has every kind registered too.
import "./kinds/charts.ts";
import "./kinds/flows.ts";
import "./kinds/handoff.ts";
import "./kinds/metrics.ts";
import "./kinds/motion.ts";
import "./kinds/planning.ts";
import "./kinds/structure.ts";
import "./kinds/systems.ts";
import "./kinds/wireframe.ts";

export * from "./registry.ts";
