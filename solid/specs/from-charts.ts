// The two chart specs whose numbers are our data: `meter.json` and `heatmap.json`. This script writes them from the
// palette and the engine's own contrast, so a token change cannot leave a figure stale — `solid/test.sh` regenerates
// them into a temp directory and `cmp`s them with the files in this directory (a drift is a `cmp` line).
//
//   node native/solid/specs/from-charts.ts            rewrites meter.json and heatmap.json here in place
//   node native/solid/specs/from-charts.ts <dir>      writes them into <dir> (the check's own way: it writes nothing)
//
//   — meter: the docs' `link on bgSubtle` pair (`apps/docs/src/palettes.ts`, open-props light) at WCAG's 4.5:1 floor,
//     in the 0..21 range the contrast kind reads: its value is the engine's ratio, so the verdict `pass 4.5:1` is a
//     comparison of two numbers and not a typed word.
//   — heatmap: `@cssints/tokens`' Open Props grey, steps 5..12 (the inks that can be type), against the three pages the
//     docs set type on (bg, bgSubtle, bgMuted). Every cell is `packages/cssints/src/color.ts`'s ratio of its row's ink on
//     its column's page, and the figure shades it by `shadeOf`'s WCAG bands.
//
// `sparkline.json` is the one chart spec that is **hand-written**, and says so: it is a recorded `--bench` series, not a
// live measurement (see native/README.md).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository, from this file (native/solid/specs). */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const { colors } = await import(`${REPO}/packages/tokens/src/open-props.ts`);
const { palettes } = await import(`${REPO}/apps/docs/src/palettes.ts`);
const { luminance, ratio } = await import(`${REPO}/packages/cssints/src/color.ts`);

/** The engine's ratio of two hex colours: the number itself, which the figure prints at two places (`shown`). */
const contrast = (fg: string, bg: string): number => ratio(luminance(fg).lum!, luminance(bg).lum!);

/** A token's value, whether the token is `{ $value }` or the value itself (Open Props writes `{ $value }`). */
type Leaf = { $value: string };
const valueOf = (token: Leaf | string): string => (typeof token === "string" ? token : token.$value);

const light = palettes["open-props"](0).light;
const meter = {
  kind: "meter",
  title: "The link, against the floor it is held to",
  intent: "One ratio (the docs' link on bgSubtle) in its 0..21 range, with the verdict the engine's comparison makes.",
  source: "apps/docs/src/palettes.ts (open-props, light); ratio: cssints/src/color.ts",
  data: {
    label: "link on bgSubtle",
    fg: light.link,
    bg: light.bgSubtle,
    min: 4.5,
    value: contrast(light.link, light.bgSubtle),
    max: 21,
  },
};

const grey = colors.gray as unknown as Record<string, Leaf | string>;
const steps = ["5", "6", "7", "8", "9", "10", "11", "12"] as const;
const rows = steps.map((step) => ({ label: `grey.${step}`, fg: valueOf(grey[step]!) }));
const columns = [
  { label: "bg", bg: light.bg },
  { label: "bgSubtle", bg: light.bgSubtle },
  { label: "bgMuted", bg: light.bgMuted },
];
const heatmap = {
  kind: "heatmap",
  title: "The grey inks, on the three pages",
  intent:
    "Our own ink steps against the pages the docs set type on; a cell is the engine's ratio, shaded by the WCAG band it lands in.",
  source: "open-props.ts (gray 5..12); palettes.ts (open-props, light); ratio: color.ts",
  data: {
    rows,
    columns,
    values: rows.map((row) => columns.map((column) => contrast(row.fg, column.bg))),
  },
};

const out = process.argv[2] ? resolve(process.argv[2]) : dirname(fileURLToPath(import.meta.url));
mkdirSync(out, { recursive: true });
for (const [name, spec] of [
  ["meter.json", meter],
  ["heatmap.json", heatmap],
] as const) {
  writeFileSync(resolve(out, name), `${JSON.stringify(spec, null, 2)}\n`);
  console.log(`from-charts: ${resolve(out, name)}`);
}
