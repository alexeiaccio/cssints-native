// The systems area, one file for its kinds — their layout and their own refusals side by side, because that is what the
// next kind of this area costs: a layout function, a check, one `register` at the bottom, and nothing else.
//
//   palette      a step a row, a hue a column: the marker, the step's swatch, its value and its contrast on the page
//   colourRoles  a role pair a row, light and dark side by side: the two swatches, the ratio and the verdict per mode
//   layerStack   a layer a row, back to front: its z as a bar, its box, its fill's alpha, its radius, its blur and shadow
//   stateMatrix  a style a row, a state a column: whether the style declares that state, as a + or a -
//   tokenTable   a token a row, its group a heading: the group's name once and its tokens under it, with the value
//   spacingScale a step a row: its name, a bar of value/largest (a 4px step of a 48px scale is half a cell), its pixels
//   typeScale    a size a row: its name, a bar of size/largest, size/lineHeight, and a specimen at its own size
//   table        a row of cells: the title a column, a rule under it, a cell cut to its column's width with `…`
//
// These are the half of the kit's `areas/systems.md` whose data is **our own tokens** (packages/tokens,
// apps/docs/src/tokens.json), so the figure cannot disagree with the design system it documents. They needed three
// things the layout did not have, and all three are additions to the *format*, not to one target: an item kind `swatch`
// (a step's own colour, which is the data and not a role), an item kind `marker` (the ▲ that marks the first step that
// reads as words), and a text's `size` with a line's `height` in cells (a 40px line of type is three cells tall: a cell
// is 16px, and a type scale cannot be drawn otherwise). `text.ts` draws all three in two branches — a swatch is `██` in
// its cell, a marker is `▲` — so the text half still has no kind in it.
//
// The palette's refusal is the kit's own `colourChecks.palette` sentence, with its hue ("Blue 300 is lighter than 200; a
// scale's steps get steadily darker."). The contrast, spacing and type sentences are ours in its voice: the kit's
// published scripts check only that a spacing value is not negative, and none of them compare a line height with its size.
import { contrastOf, HEX, luminance, shown, WORDS } from "../contrast.ts";
import type { Bar, Item, Layout, LayoutLine, Paint, Pair, Swatch, TextItem } from "../registry.ts";
import { CELL_HEIGHT, CELL_WIDTH, register } from "../registry.ts";
import type {
  ColourRolesSpec,
  LayerStackSpec,
  PaletteSpec,
  SpacingSpec,
  StateMatrixSpec,
  TableSpec,
  TokenTableSpec,
  TypeScaleSpec,
} from "../spec.ts";
import {
  barLine,
  cellWidth,
  cells,
  exactFill,
  finish,
  focusOf,
  isObject,
  longest,
  number,
  paintOf,
  rowsOf,
  say,
  textItem,
  truncate,
} from "./shared.ts";

/**
 * A palette: one row a step, one column a hue — glyph-kit's tonal scale. The cell is the marker (the first step of that
 * hue that reads as words on the page, 4.5 to 1), the step's swatch, its value and its contrast on the page. The contrast
 * is computed from the two colours here, with the same formula `check` refuses by, so a swatch and its number cannot
 * disagree; the swatch itself is the step's `#rrggbb`, the one colour a figure draws as itself.
 */
function palette(spec: PaletteSpec): Layout {
  const focus = focusOf(spec);
  const { hues, page = "#ffffff" } = spec.data;
  const steps: string[] = [];
  for (const hue of hues) for (const step of hue.steps) if (!steps.includes(step.name)) steps.push(step.name);
  const ratios = new Map<string, number>();
  for (const hue of hues)
    for (const step of hue.steps) ratios.set(`${hue.name}\t${step.name}`, contrastOf(step.value, page) ?? 1);
  const ratioTexts = [...ratios.values()].map((r) => shown(r));
  const stepWidth = Math.max(2, longest(steps)) + 2;
  const valueWidth = Math.max(7, longest(hues.flatMap((hue) => hue.steps.map((step) => step.value)))) + 1;
  const ratioWidth = longest(ratioTexts) + 2;
  // the marker (two cells, so the ▲ reads apart from its swatch), the swatch, a cell, the value, the ratio and the gap
  const slot = 2;
  const cell = slot + 2 + 1 + valueWidth + ratioWidth;
  const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - cells(text)));
  const padStart = (text: string, width: number) => " ".repeat(Math.max(0, width - cells(text))) + text;
  const head = `${" ".repeat(stepWidth + slot)}${hues.map((hue) => pad(hue.name, cell)).join("")}`;
  const lines: LayoutLine[] = [
    { items: [textItem("fig-hues", head, cells(head), "muted", "label")] },
  ];
  const swatches: Swatch[] = [];
  const labels: Layout["labels"] = [];
  steps.forEach((stepName, row) => {
    const items: Item[] = [textItem(`fig-step-${row}`, stepName, stepWidth, paintOf(focus, stepName), "label")];
    labels.push({ textId: `fig-step-${row}`, text: stepName });
    hues.forEach((hue, h) => {
      const step = hue.steps.find((s) => s.name === stepName);
      if (!step) {
        items.push({ kind: "space", id: `fig-palette-gap-${h}-${row}`, cells: cell, paint: "ink" });
        return;
      }
      const contrast = ratios.get(`${hue.name}\t${step.name}`) ?? 1;
      // the first step of the hue that passes, in the hue's own order
      const marked = hue.steps.find((s) => (ratios.get(`${hue.name}\t${s.name}`) ?? 0) >= WORDS)?.name === step.name;
      items.push(
        marked
          ? { kind: "marker", id: `fig-marker-${h}-${row}`, cells: slot, paint: "good" }
          : textItem(`fig-marker-gap-${h}-${row}`, " ".repeat(slot), slot, "ink"),
        { kind: "swatch", id: `fig-swatch-${h}-${row}`, cells: 2, paint: "ink", value: step.value },
        textItem(`fig-swatch-value-${h}-${row}`, " ", 1, "ink"),
        textItem(`fig-value-${h}-${row}`, step.value, valueWidth, "ink", "value"),
        textItem(`fig-ratio-${h}-${row}`, shown(contrast), ratioWidth, "muted", "ratio"),
      );
      swatches.push({
        id: `fig-swatch-${h}-${row}`,
        textId: `fig-value-${h}-${row}`,
        hue: hue.name,
        step: step.name,
        value: step.value,
        contrast,
        marked,
      });
    });
    lines.push({ items });
  });
  return finish(spec, "palette", stepWidth + cell * hues.length, lines, [], labels, [], [], swatches);
}

/**
 * A role's light and dark values with a verdict: one row a role pair, a mode a column — the foreground's swatch, the
 * background's, the ratio and the verdict the pair's floor gives. A swatch is the role's own `#rrggbb` (the one colour a
 * figure draws as itself, as in a palette), the ratio is recomputed from the pair's two colours by `check`, and the
 * verdict paints the ratio and its word `good` or `problem`: a role pair that misses its floor is a figure that says so.
 */
function colourRoles(spec: ColourRolesSpec): Layout {
  const focus = focusOf(spec);
  const roles = spec.data;
  const modes = ["light", "dark"] as const;
  const labelWidth = longest(roles.map((role) => role.label)) + 1;
  const ratioTexts = roles.flatMap((role) => modes.map((mode) => `${shown(role[mode].ratio)}:1`));
  const verdicts = roles.flatMap((role) => modes.map((mode) => `${role[mode].ratio >= role.min ? "pass" : "fails"} ${role.min}:1`));
  const ratioWidth = longest(ratioTexts) + 1;
  const verdictWidth = longest(verdicts) + 1;
  // a mode's block: the foreground's swatch, a cell, the background's, a cell, the ratio, a cell, the verdict
  const modeWidth = 2 + 1 + 2 + 1 + ratioWidth + 1 + verdictWidth;
  const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - cells(text)));
  const padStart = (text: string, width: number) => " ".repeat(Math.max(0, width - cells(text))) + text;
  const head = `${pad("role", labelWidth)}${pad("light", modeWidth)}${pad("dark", modeWidth)}`.trimEnd();
  const lines: LayoutLine[] = [{ items: [textItem("fig-modes", head, cells(head), "muted", "label")] }];
  const records: Pair[] = [];
  const labels: Layout["labels"] = [];
  roles.forEach((role, i) => {
    const items: Item[] = [textItem(`fig-role-${i}`, role.label, labelWidth, paintOf(focus, role.label))];
    labels.push({ textId: `fig-role-${i}`, text: role.label });
    modes.forEach((mode) => {
      const pair = role[mode];
      const pass = pair.ratio >= role.min;
      const paint: Paint = pass ? "good" : "problem";
      const id = `fig-role-${i}-${mode}`;
      items.push(
        { kind: "swatch", id: `${id}-fg`, cells: 2, paint: "ink", value: pair.fg },
        textItem(`${id}-gap`, " ", 1, "ink"),
        { kind: "swatch", id: `${id}-bg`, cells: 2, paint: "ink", value: pair.bg },
        textItem(`${id}-gap-bg`, " ", 1, "ink"),
        textItem(`${id}-ratio`, `${shown(pair.ratio)}:1`, ratioWidth, paint, "ratio"),
        textItem(`${id}-gap2`, " ", 1, "ink"),
        textItem(`${id}-verdict`, `${pass ? "pass" : "fails"} ${role.min}:1`, verdictWidth, paint, "verdict"),
      );
      records.push({
        textId: `${id}-ratio`,
        label: `${role.label} (${mode})`,
        ratio: pair.ratio,
        min: role.min,
        pass,
        verdictId: `${id}-verdict`,
      });
    });
    lines.push({ items });
  });
  return finish(spec, "colourRoles", labelWidth + modeWidth * modes.length, lines, [], labels, [], [], [], records);
}

/** WCAG's three floors: a role pair's floor and a contrast pair's are the same three numbers. */
const FLOORS = [3, 4.5, 7] as const;

/** A colour-roles figure: every role pair has both modes, six-digit hex colours, and a ratio its colours make. */
function colourRolesProblems(data: unknown): string[] {
  const roles = rowsOf(data);
  if (!roles.length)
    return [
      'A colour-roles figure needs its roles: [{ "label": "text on bg", "min": 7, "light": { "fg": "#030507", ' +
        '"bg": "#f8f9fa", "ratio": 19.37 }, "dark": { "fg": "#f1f3f5", "bg": "#030507", "ratio": 18.35 } }].',
    ];
  const out: string[] = [];
  for (const [i, role] of roles.entries()) {
    if (!isObject(role) || typeof role.label !== "string" || !role.label.trim()) {
      out.push(`Role ${i + 1} needs a label: what the pair is for, like "text on bg".`);
      continue;
    }
    const label = role.label;
    const min = number(role.min);
    if (min === undefined) out.push(`${label} needs a min: 3, 4.5 or 7, WCAG's three floors.`);
    else if (!(FLOORS as readonly number[]).includes(min))
      out.push(`${label}'s min is ${min}: a minimum is 3, 4.5 or 7, WCAG's three floors.`);
    for (const mode of ["light", "dark"] as const) {
      const pair = role[mode];
      if (!isObject(pair)) {
        out.push(`${label} needs its ${mode} pair: { "fg": "#030507", "bg": "#f8f9fa", "ratio": 19.37 }.`);
        continue;
      }
      for (const [field, value] of [["fg", pair.fg], ["bg", pair.bg]] as const)
        if (!HEX.test(String(value))) out.push(`${label}'s ${mode} ${field} is a hex value like #030507, not ${say(value)}.`);
      const ratio = number(pair.ratio);
      if (ratio === undefined) {
        out.push(`${label}'s ${mode} pair needs its ratio: the number of ${say(pair.fg)} on ${say(pair.bg)}, to two places.`);
        continue;
      }
      const own = contrastOf(pair.fg, pair.bg);
      if (own !== undefined && Math.abs(own - ratio) > 0.005)
        out.push(`${label}'s ${mode} pair says ${shown(ratio)}:1, but ${pair.fg} on ${pair.bg} makes ${shown(own)}:1.`);
    }
  }
  return out;
}

/**
 * A layer stack: a layer a row, back to front — its z as a bar on the stack's own depth, the box the frame gave it, the
 * alpha of its fill, its corner radius, and the blur and shadow its effects table carries. The data is the Dialog's own
 * overlays measured from their frames (`solid/specs/from-frames.ts`), so the figure cannot invent a z scale: the page,
 * the scrim, the dialog and the menu are each a command (or a table row) of the frame they open in.
 */
function layerStack(spec: LayerStackSpec): Layout {
  const focus = focusOf(spec);
  const layers = spec.data;
  const maxZ = Math.max(1, ...layers.map((layer) => layer.z));
  const labelWidth = longest(layers.map((layer) => layer.name)) + 1;
  const boxes = layers.map((layer) => `${Math.round(layer.box.width)}x${Math.round(layer.box.height)}`);
  const alphas = layers.map((layer) => shown(layer.alpha));
  const radii = layers.map((layer) => `${Math.round(layer.radius)}px`);
  const blurs = layers.map((layer) => (layer.blur === undefined ? "-" : `blur ${Math.round(layer.blur)}`));
  const shadows = layers.map((layer) =>
    layer.shadow === undefined
      ? "-"
      : `${Math.round(layer.shadow.x)},${Math.round(layer.shadow.y)} ${Math.round(layer.shadow.blur)}`,
  );
  const numberWidth = Math.max(2, String(maxZ).length) + 2;
  const boxWidth = longest(boxes) + 1;
  const alphaWidth = Math.max(cells("alpha"), longest(alphas)) + 1;
  const radiusWidth = Math.max(cells("radius"), longest(radii)) + 1;
  const blurWidth = Math.max(cells("blur"), longest(blurs)) + 1;
  const shadowWidth = Math.max(cells("shadow"), longest(shadows)) + 1;
  const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - cells(text)));
  const padStart = (text: string, width: number) => " ".repeat(Math.max(0, width - cells(text))) + text;
  const head =
    pad("layer", labelWidth) +
    padStart("z", maxZ + numberWidth) +
    " " +
    pad("box", boxWidth) +
    pad("alpha", alphaWidth) +
    pad("radius", radiusWidth) +
    pad("blur", blurWidth) +
    "shadow";
  const lines: LayoutLine[] = [{ items: [textItem("fig-layers", head, cells(head), "muted", "label")] }];
  const bars: Bar[] = [];
  const labels: Layout["labels"] = [];
  layers.forEach((layer, i) => {
    bars.push({
      fillId: `fig-fill-${i}`,
      trackId: `fig-track-${i}`,
      textId: `fig-z-${i}`,
      label: layer.name,
      value: layer.z,
      max: maxZ,
      fill: layer.z,
      track: maxZ,
      text: String(layer.z),
    });
    labels.push({ textId: `fig-label-${i}`, text: layer.name });
    const line = barLine(i, layer.name, layer.z, maxZ, String(layer.z), numberWidth, labelWidth, paintOf(focus, layer.name));
    // the z number is right-aligned against its bar; a cell keeps it off the box
    line.items.push(textItem(`fig-z-gap-${i}`, " ", 1, "ink"));
    for (const [id, text, width] of [
      ["box", boxes[i]!, boxWidth],
      ["alpha", alphas[i]!, alphaWidth],
      ["radius", radii[i]!, radiusWidth],
      ["blur", blurs[i]!, blurWidth],
      ["shadow", shadows[i]!, shadowWidth],
    ] as const)
      line.items.push(textItem(`fig-${id}-${i}`, text, width, "muted", "value"));
    lines.push(line);
  });
  return finish(spec, "layerStack", cells(head), lines, bars, labels);
}

/** A layer stack: a layer has a name, a z, a box, an alpha in 0..1 and a radius; the rows are back to front. */
function layerStackProblems(data: unknown): string[] {
  const layers = rowsOf(data);
  if (!layers.length)
    return [
      'A layer stack needs its layers, back to front: [{ "name": "the page", "z": 0, "box": { "width": 360, ' +
        '"height": 480 }, "alpha": 1, "radius": 0 }].',
    ];
  const out: string[] = [];
  const names = new Set<string>();
  let last = -1;
  for (const [i, layer] of layers.entries()) {
    if (!isObject(layer) || typeof layer.name !== "string" || !layer.name.trim()) {
      out.push(`Layer ${i + 1} needs a name: what the layer is, like "the page".`);
      continue;
    }
    const name = layer.name;
    if (names.has(name)) out.push(`"${name}" is two layers: one name, one layer.`);
    names.add(name);
    const z = number(layer.z);
    if (z === undefined || z < 0) out.push(`${name} needs its z: 0 or more, 0 being the page.`);
    else {
      if (z < last) out.push(`${name} is at z ${z} after a layer at z ${last}: a layer stack is back to front.`);
      last = Math.max(last, z);
    }
    const box = layer.box;
    if (!isObject(box) || !(number(box.width)! > 0) || !(number(box.height)! > 0))
      out.push(`${name} needs its box: { "width": 360, "height": 480 }, in pixels.`);
    const alpha = number(layer.alpha);
    if (alpha === undefined || alpha < 0 || alpha > 1) out.push(`${name}'s alpha is 0 to 1, not ${say(layer.alpha)}.`);
    const radius = number(layer.radius);
    if (radius === undefined || radius < 0)
      out.push(`${name} needs its radius in pixels: 0 for a rectangle, not ${say(layer.radius)}.`);
    if (layer.blur !== undefined) {
      const blur = number(layer.blur);
      if (blur === undefined || !(blur > 0))
        out.push(`${name}'s blur is a positive number of pixels, not ${say(layer.blur)}.`);
    }
    if (layer.shadow !== undefined) {
      const shadow = layer.shadow;
      if (!isObject(shadow) || number(shadow.x) === undefined || number(shadow.y) === undefined || !(number(shadow.blur)! > 0))
        out.push(`${name}'s shadow needs x, y and a positive blur, in pixels: ${say(shadow)} is not one.`);
    }
  }
  return out;
}

/** A layer stack's names are its layers' own: a focus points at one as it is drawn. */
function layerNames(data: unknown): string[] {
  return rowsOf(data).flatMap((layer) => (isObject(layer) && typeof layer.name === "string" ? [layer.name] : []));
}

/**
 * A state matrix: a style a row, a state a column, a `+` where the style declares that state and a `-` where it does not.
 * The rows come from the pages' own style modules (`solid/specs/from-styles.ts` walks their `s` maps and the Sensors
 * page's exports for a `:hover`/`:focus`/`:active` key), so the figure is the styles' own matrix: a state added to a
 * style is a `+` in the same commit, and the terminal draws the same cells.
 */
function stateMatrix(spec: StateMatrixSpec): Layout {
  const focus = focusOf(spec);
  const { columns, rows } = spec.data;
  const nameWidth = longest(rows.map((row) => row.name)) + 1;
  const columnWidths = columns.map((column) => Math.max(cells(column), 2) + 2);
  const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - cells(text)));
  const head = [pad("style", nameWidth), ...columns.map((column, c) => pad(column, columnWidths[c]!))]
    .join("")
    .trimEnd();
  const lines: LayoutLine[] = [{ items: [textItem("fig-states-head", head, cells(head), "muted", "label")] }];
  const labels: Layout["labels"] = [];
  rows.forEach((row, i) => {
    const items: Item[] = [textItem(`fig-style-${i}`, row.name, nameWidth, paintOf(focus, row.name))];
    labels.push({ textId: `fig-style-${i}`, text: row.name });
    columns.forEach((column, c) => {
      const on = row.states.includes(column);
      items.push(textItem(`fig-state-${i}-${c}`, on ? "+" : "-", columnWidths[c]!, on ? "good" : "muted", "value"));
    });
    lines.push({ items });
  });
  return finish(spec, "stateMatrix", cells(head), lines, [], labels);
}

/** A state matrix: its columns, its rows, and a row's states all being columns. */
function stateMatrixProblems(data: unknown): string[] {
  if (!isObject(data)) return ['A state matrix needs its columns and rows: { "columns": ["hover"], "rows": [{ "name": "widgets.button", "states": ["hover"] }] }.'];
  const columns = rowsOf(data.columns);
  const rows = rowsOf(data.rows);
  const out: string[] = [];
  const columnNames = columns.filter((column): column is string => typeof column === "string" && !!column.trim());
  if (!columnNames.length) out.push('A state matrix needs its columns: ["hover", "focus", "active"].');
  if (columnNames.length !== new Set(columnNames).size) {
    const twice = columnNames.find((column, i) => columnNames.indexOf(column) !== i);
    out.push(`"${twice}" is two columns: one name, one column.`);
  }
  if (!rows.length) out.push('A state matrix needs its rows: [{ "name": "widgets.button", "states": ["hover"] }].');
  const names = new Set<string>();
  for (const [i, row] of rows.entries()) {
    if (!isObject(row) || typeof row.name !== "string" || !row.name.trim()) {
      out.push(`Row ${i + 1} needs a name: the style, like "widgets.button".`);
      continue;
    }
    const name = row.name;
    if (names.has(name)) out.push(`"${name}" is two rows: one style, one row.`);
    names.add(name);
    const states = rowsOf(row.states);
    for (const state of states)
      if (typeof state !== "string" || !columnNames.includes(state))
        out.push(`${name} declares ${say(state)}, which is not one of the columns (${columnNames.join(", ")}).`);
    if (states.length !== new Set(states).size) out.push(`${name} declares a state twice: one state, one cell.`);
  }
  return out;
}

/** A state matrix's names are its rows' own: a focus points at a style as it is drawn. */
function stateMatrixNames(data: unknown): string[] {
  return isObject(data)
    ? rowsOf(data.rows).flatMap((row) => (isObject(row) && typeof row.name === "string" ? [row.name] : []))
    : [];
}

/**
 * A token table: a token a row, its group a heading — the group's name on the group's first row and blank under it, the
 * token's own name, and its value as the token file resolves it (`4px`, `1.2`, `400`). The data is `apps/docs`'
 * `tokens.json` (`solid/specs/from-tokens.ts` resolves the `calc(Npx * {scale.k})` forms with the scale the file
 * declares), so the table cannot disagree with the design system it lists; a group is one run of rows, in the file's
 * order.
 */
function tokenTable(spec: TokenTableSpec): Layout {
  const rows = spec.data;
  const groupWidth = longest(rows.map((row) => row.group)) + 2;
  const nameWidth = longest(rows.map((row) => row.name)) + 2;
  const valueWidth = longest([...rows.map((row) => row.value), "value"]) + 1;
  const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - cells(text)));
  const head = `${pad("group", groupWidth)}${pad("token", nameWidth)}value`;
  const lines: LayoutLine[] = [{ items: [textItem("fig-tokens-head", head, cells(head), "muted", "label")] }];
  const labels: Layout["labels"] = [];
  rows.forEach((row, i) => {
    const first = i === 0 || rows[i - 1]!.group !== row.group;
    labels.push({ textId: `fig-token-${i}`, text: row.name });
    lines.push({
      items: [
        textItem(`fig-group-${i}`, first ? row.group : " ".repeat(cells(row.group)), groupWidth, "muted", "label"),
        textItem(`fig-token-${i}`, row.name, nameWidth, "ink", "label"),
        textItem(`fig-token-value-${i}`, row.value, valueWidth, "ink", "value"),
      ],
    });
  });
  return finish(spec, "tokenTable", cells(head), lines, [], labels);
}

/** A token table: every row has a group, a name and a value, and a group's rows are one run (a table cannot reopen one). */
function tokenTableProblems(data: unknown): string[] {
  const rows = rowsOf(data);
  if (!rows.length)
    return ['A token table needs its tokens: [{ "group": "space", "name": "xs", "value": "4px" }].'];
  const out: string[] = [];
  const closed = new Set<string>();
  let group = "";
  const names = new Map<string, Set<string>>();
  for (const [i, row] of rows.entries()) {
    if (!isObject(row)) {
      out.push(`Token ${i + 1} is not an object: it needs a group, a name and a value.`);
      continue;
    }
    const ok = (field: "group" | "name" | "value") => typeof row[field] === "string" && !!(row[field] as string).trim();
    if (!ok("group") || !ok("name") || !ok("value")) {
      out.push(`Token ${i + 1} needs its group, its name and its value: ${say(row)} is not one.`);
      continue;
    }
    const rowGroup = row.group as string;
    const rowName = row.name as string;
    if (rowGroup !== group) {
      if (closed.has(rowGroup)) out.push(`"${rowGroup}" appears twice: a group is one run of rows.`);
      closed.add(group);
      group = rowGroup;
    }
    const seen = names.get(rowGroup) ?? new Set<string>();
    if (seen.has(rowName)) out.push(`${rowGroup}.${rowName} is two tokens: one name, one row.`);
    seen.add(rowName);
    names.set(rowGroup, seen);
  }
  return out;
}

/**
 * A table: a heading a column, a row of cells — the generic kind, on the cell grid. A column is as wide as its longest
 * cell or its heading, capped by `options.max`; a value wider than its column is cut with `…`, counted in **cells** (a
 * CJK glyph is two) and not in bytes. The heading is drawn once, a rule of `-` separates it from the body unless
 * `headerRule` is false, and a column may read flush right, which is a number's own alignment. One cell is one line: a
 * cell has no alpha today, so a zebra stripe would be a second item kind and not a table's business.
 *
 * `solid/specs/from-targets.ts` writes this repository's one, from the Targets table of `native/docs/map.md`.
 */
function table(spec: TableSpec): Layout {
  const focus = focusOf(spec);
  const { columns, rows, headerRule = true } = spec.data;
  const max = spec.options?.max;
  const widths = columns.map((column, c) => {
    const wanted = Math.max(cellWidth(column.title), ...rows.map((row) => cellWidth(row[c] ?? "")));
    return Math.max(1, max === undefined ? wanted : Math.min(max, wanted));
  });
  const padEnd = (text: string, width: number) => text + " ".repeat(Math.max(0, width - cellWidth(text)));
  const padStart = (text: string, width: number) => " ".repeat(Math.max(0, width - cellWidth(text))) + text;
  const cellOf = (text: string, c: number): string => {
    const width = widths[c]!;
    const cut = truncate(text, width);
    return columns[c]!.align === "right" ? padStart(cut, width) : padEnd(cut, width);
  };
  const gap = (id: string): Item => ({ kind: "space", id, cells: 2, paint: "ink" });
  const spread = (
    id: (c: number) => string,
    text: readonly string[],
    paint: (c: number) => Paint,
    role: (c: number) => "label" | "value",
  ) =>
    columns.flatMap((_, c): Item[] => [
      textItem(id(c), text[c]!, widths[c]!, paint(c), role(c)),
      ...(c < columns.length - 1 ? [gap(`${id(c)}-gap`)] : []),
    ]);
  const muted = () => "muted" as const;
  const lines: LayoutLine[] = [
    {
      items: spread(
        (c) => `fig-head-${c}`,
        columns.map((column, c) => cellOf(column.title, c)),
        // a focus may name a heading as well as a row: a heading is drawn, and a name it refuses would be a lie
        (c) => (focus && focus.on.includes(columns[c]!.title) ? paintOf(focus, columns[c]!.title) : "muted"),
        () => "label",
      ),
    },
  ];
  if (headerRule)
    lines.push({
      items: spread((c) => `fig-rule-${c}`, columns.map((_, c) => "-".repeat(widths[c]!)), muted, () => "label"),
    });
  const labels: Layout["labels"] = [];
  rows.forEach((row, r) => {
    const drawn = columns.map((_, c) => cellOf(row[c] ?? "", c));
    labels.push({ textId: `fig-cell-${r}-0`, text: drawn[0] ?? "" });
    lines.push({
      items: spread(
        (c) => `fig-cell-${r}-${c}`,
        drawn,
        // the row's label is the data's first cell, which is what a focus names (the cut is the column's, not the name's)
        (c) => (c === 0 ? paintOf(focus, row[0] ?? "") : "ink"),
        (c) => (c === 0 ? "label" : "value"),
      ),
    });
  });
  const width = widths.reduce((n, w) => n + w, 0) + 2 * Math.max(0, columns.length - 1);
  return finish(spec, "table", width, lines, [], labels);
}

/** A table: a heading a column, a cell a column in every row, and a cap that is a whole number of cells. */
function tableProblems(data: unknown, options: unknown): string[] {
  if (!isObject(data))
    return ['A table needs its columns and rows: { "columns": [{ "title": "target" }], "rows": [["Desktop (macOS)"]] }.'];
  const columns = rowsOf(data.columns);
  const rows = rowsOf(data.rows);
  const out: string[] = [];
  if (!columns.length)
    out.push('A table needs its columns: [{ "title": "target" }, { "title": "status", "align": "right" }].');
  const titles: string[] = [];
  for (const [c, column] of columns.entries()) {
    if (!isObject(column) || typeof column.title !== "string" || !column.title.trim()) {
      out.push(`Column ${c + 1} needs a title: the heading it is drawn with.`);
      continue;
    }
    titles.push(column.title);
    if (column.align !== undefined && column.align !== "left" && column.align !== "right")
      out.push(`Column ${c + 1}'s align is left or right, not ${say(column.align)}.`);
  }
  if (titles.length !== new Set(titles).size) {
    const twice = titles.find((title, i) => titles.indexOf(title) !== i);
    out.push(`"${twice}" is two columns: one heading, one column.`);
  }
  if (!rows.length) out.push('A table needs its rows: [["Desktop (macOS)", "Clay", "a page in a window"]].');
  for (const [r, row] of rows.entries()) {
    if (!Array.isArray(row)) {
      out.push(`Row ${r + 1} is not a row of cells: [...] is.`);
      continue;
    }
    if (row.length !== columns.length)
      out.push(`Row ${r + 1} has ${row.length} cell${row.length === 1 ? "" : "s"}: the table has ${columns.length} columns.`);
    for (const [c, cell] of row.entries())
      if (typeof cell !== "string") out.push(`Row ${r + 1}'s cell ${c + 1} is not text: ${say(cell)} is not one.`);
  }
  if (data.headerRule !== undefined && typeof data.headerRule !== "boolean")
    out.push(`A table's headerRule is true or false, not ${say(data.headerRule)}.`);
  const max = isObject(options) ? options.max : undefined;
  if (max !== undefined) {
    const n = number(max);
    if (n === undefined || !Number.isInteger(n) || n <= 0)
      out.push(`options.max must be a whole number of cells above zero: it is ${say(max)}.`);
  }
  return out;
}

/** A table's names are its columns' headings and its first column's cells: a focus points at one as it is drawn. */
function tableNames(data: unknown): string[] {
  if (!isObject(data)) return [];
  const titles = rowsOf(data.columns).flatMap((column) =>
    isObject(column) && typeof column.title === "string" ? [column.title] : [],
  );
  const firsts = rowsOf(data.rows).flatMap((row) =>
    Array.isArray(row) && typeof row[0] === "string" ? [row[0]] : [],
  );
  return [...titles, ...firsts];
}

/**
 * A spacing scale: a step a row — its name, a bar of `value/largest`, its pixels. A cell is 8px and the track is the
 * largest step, so the scale maps to cells at its own length: a 4px step of a 48px scale is **half a cell** (`▌` in the
 * text half, 4px of fill on the pixel targets), not "one cell", and every step's fill is exactly its value's.
 */
function spacingScale(spec: SpacingSpec): Layout {
  const focus = focusOf(spec);
  const steps = spec.data;
  const largest = Math.max(...steps.map((step) => step.value));
  const track = Math.max(1, Math.ceil(largest / CELL_WIDTH));
  const labelWidth = longest(steps.map((step) => step.name)) + 1;
  const texts = steps.map((step) => `${step.value}px`);
  const textWidth = longest(texts) + 1;
  const note = `A cell is ${CELL_WIDTH}px: the track is the largest step, ${largest}px.`;
  const width = Math.max(labelWidth + track + textWidth, cells(note));
  const bars: Bar[] = [];
  const labels: Layout["labels"] = [];
  const lines = steps.map((step, i) => {
    const fill = exactFill(step.value, largest, track);
    bars.push({
      fillId: `fig-fill-${i}`,
      trackId: `fig-track-${i}`,
      textId: `fig-num-${i}`,
      label: step.name,
      value: step.value,
      max: largest,
      fill,
      track,
      text: texts[i]!,
    });
    labels.push({ textId: `fig-label-${i}`, text: step.name });
    return barLine(i, step.name, fill, track, texts[i]!, textWidth, labelWidth, paintOf(focus, step.name));
  });
  lines.push({ items: [textItem("fig-note", note, cells(note), "muted", "note")] });
  return finish(spec, "spacingScale", width, lines, bars, labels);
}

/**
 * A type scale: a size a row — its name, a bar of `size/largest`, `size/lineHeight`, and a specimen `Aa` at the size
 * itself. A 40px line is three cells tall (a cell is 16px), so this is the one kind whose rows differ in height: the
 * layout says so in `height`, the page writes it through the value channel, and the terminal draws the row's cells with
 * the text in the first of them. The cell figure cannot draw type at its size — a cell has one size — so it prints the
 * numbers and draws the proportional bar; the specimen's `size` is what a pixel target honours.
 */
function typeScale(spec: TypeScaleSpec): Layout {
  const focus = focusOf(spec);
  const steps = [...spec.data].sort((a, b) => b.size - a.size);
  const largest = steps[0]?.size ?? 1;
  const track = 14;
  const labelWidth = longest(steps.map((step) => step.name)) + 1;
  const numbers = steps.map((step) => `${step.size}/${step.lineHeight}`);
  const numberWidth = longest(numbers) + 1;
  // two glyphs of about 0.7em: enough cells that a 40px "Aa" is not cut by the next item
  const specimenWidth = Math.max(2, ...steps.map((step) => Math.ceil((step.size * 1.4) / CELL_WIDTH))) + 1;
  const width = labelWidth + track + numberWidth + specimenWidth;
  const bars: Bar[] = [];
  const labels: Layout["labels"] = [];
  const lines = steps.map((step, i) => {
    const fill = exactFill(step.size, largest, track);
    bars.push({
      fillId: `fig-fill-${i}`,
      trackId: `fig-track-${i}`,
      textId: `fig-num-${i}`,
      label: step.name,
      value: step.size,
      max: largest,
      fill,
      track,
      text: numbers[i]!,
    });
    labels.push({ textId: `fig-label-${i}`, text: step.name });
    const specimen: TextItem = {
      ...textItem(`fig-type-${i}`, "Aa", specimenWidth, paintOf(focus, step.name), "value"),
      size: step.size,
    };
    const line: LayoutLine = {
      items: [
        textItem(`fig-label-${i}`, step.name, labelWidth, paintOf(focus, step.name)),
        { kind: "bar", id: `fig-track-${i}`, fillId: `fig-fill-${i}`, cells: track, fill, paint: paintOf(focus, step.name) },
        textItem(`fig-num-${i}`, numbers[i]!, numberWidth, "muted", "ratio"),
        { kind: "space", id: `fig-type-gap-${i}`, cells: 1, paint: "ink" },
        specimen,
      ],
      height: Math.max(1, Math.ceil(step.lineHeight / CELL_HEIGHT)),
    };
    return line;
  });
  return finish(spec, "typeScale", width, lines, bars, labels);
}

/**
 * A palette: hues of named steps whose colours are `#rrggbb`, each hue one direction — steadily darker or steadily
 * lighter — and one name a step. The kit's own `coloursChecks.palette`, sentence and all, with the hue in front of the
 * step: "Blue 300 is lighter than 200; a scale's steps get steadily darker."
 */
function paletteProblems(data: unknown): string[] {
  const palette = isObject(data) ? data : {};
  const hues = rowsOf(palette.hues).filter(isObject);
  if (!hues.length)
    return ['A palette needs its hues: [{ "name": "Blue", "steps": [{ "name": "50", "value": "#eef3ff" }] }].'];
  const out: string[] = [];
  const page = palette.page ?? "#ffffff";
  if (!HEX.test(String(page))) out.push(`Write the page colour as a hex value like #ffffff, not ${say(page)}.`);
  for (const [h, hue] of hues.entries()) {
    const name = typeof hue.name === "string" && hue.name ? hue.name : `hue ${h + 1}`;
    const steps = rowsOf(hue.steps);
    if (!steps.length) {
      out.push(`${name} has no steps: a hue is a list of { "name": "50", "value": "#eef3ff" }.`);
      continue;
    }
    const named = new Set<string>();
    const lengths: { name: string; l: number }[] = [];
    for (const [i, step] of steps.entries()) {
      if (!isObject(step) || typeof step.name !== "string" || !step.name) {
        out.push(`${name}'s step ${i + 1} needs a name: the step's place in the scale, like "50".`);
        continue;
      }
      if (named.has(step.name)) out.push(`${name} has two steps named ${step.name}: a step's name is its row.`);
      named.add(step.name);
      if (!HEX.test(String(step.value))) {
        out.push(`${name} ${step.name}: write the colour as a hex value like #1f4fd6, not ${say(step.value)}.`);
        continue;
      }
      lengths.push({ name: step.name, l: luminance(step.value)! });
    }
    // the kit's direction rule: the hue's own endpoints say which way its scale runs, and every step follows it
    const first = lengths[0];
    const last = lengths[lengths.length - 1];
    const direction = first && last ? Math.sign(last.l - first.l) : 0;
    const breakAt = direction
      ? lengths.findIndex((s, i) => i > 0 && s.l !== lengths[i - 1]!.l && Math.sign(s.l - lengths[i - 1]!.l) !== direction)
      : -1;
    if (breakAt > 0) {
      const step = lengths[breakAt]!;
      const before = lengths[breakAt - 1]!;
      out.push(
        `${name} ${step.name} is ${direction < 0 ? "lighter" : "darker"} than ${before.name}; a scale's steps get ` +
          `steadily ${direction < 0 ? "darker" : "lighter"}.`,
      );
    }
  }
  return out;
}

/** A spacing scale: named steps in pixels, from the smallest to the largest — a scale that does not grow is not a scale. */
function spacingProblems(data: unknown): string[] {
  const steps = rowsOf(data);
  if (!steps.length)
    return ['A spacing scale needs its steps: [{ "name": "space-1", "value": 4 }, ...], in pixels, smallest first.'];
  const out: string[] = [];
  const clean: { name: string; value: number }[] = [];
  for (const [i, step] of steps.entries()) {
    const value = isObject(step) ? number(step.value) : undefined;
    if (!isObject(step) || typeof step.name !== "string" || !step.name || value === undefined) {
      out.push(`${isObject(step) && typeof step.name === "string" && step.name ? step.name : `Step ${i + 1}`} needs a name and a value: a length in pixels.`);
      continue;
    }
    if (value <= 0) out.push(`${step.name} has a value of ${value}px: a step is above zero.`);
    clean.push({ name: step.name, value });
  }
  for (let i = 1; i < clean.length; i++) {
    const step = clean[i]!;
    const before = clean[i - 1]!;
    if (step.value < before.value)
      out.push(`${step.name} is ${step.value}px, less than ${before.name}'s ${before.value}px before it; a spacing scale grows.`);
  }
  return out;
}

/** A type scale: named sizes with their line heights, no size under 8 px, no line height under its size. */
function typeProblems(data: unknown): string[] {
  const steps = rowsOf(data);
  if (!steps.length)
    return ['A type scale needs its sizes: [{ "name": "body", "size": 16, "lineHeight": 24 }, ...], in pixels.'];
  const out: string[] = [];
  for (const [i, step] of steps.entries()) {
    const size = isObject(step) ? number(step.size) : undefined;
    const lineHeight = isObject(step) ? number(step.lineHeight) : undefined;
    if (!isObject(step) || typeof step.name !== "string" || !step.name || size === undefined || lineHeight === undefined) {
      out.push(`${isObject(step) && typeof step.name === "string" && step.name ? step.name : `Step ${i + 1}`} needs a name, a size and a line height: pixels, like { "name": "body", "size": 16, "lineHeight": 24 }.`);
      continue;
    }
    if (size < 8) out.push(`${step.name} is ${size}px: a size under 8px is unreadable.`);
    if (lineHeight < size) out.push(`${step.name} is ${size}/${lineHeight}: a line height under its size (${size}) crowds the lines.`);
  }
  return out;
}

/** A palette's names are its hues and their steps; a scale's are its steps' names. */
function paletteNames(data: unknown): string[] {
  const palette = isObject(data) ? data : {};
  const names: string[] = [];
  for (const hue of rowsOf(palette.hues))
    if (isObject(hue)) {
      if (typeof hue.name === "string") names.push(hue.name);
      for (const step of rowsOf(hue.steps))
        if (isObject(step) && typeof step.name === "string") names.push(step.name);
    }
  return names;
}

function stepNames(data: unknown): string[] {
  return rowsOf(data)
    .filter(isObject)
    .map((step, i) => (typeof step.name === "string" && step.name ? step.name : `row ${i + 1}`));
}

register("colourRoles", { layout: colourRoles, check: colourRolesProblems });
register("layerStack", { layout: layerStack, check: layerStackProblems, names: layerNames });
register("stateMatrix", { layout: stateMatrix, check: stateMatrixProblems, names: stateMatrixNames });
register("tokenTable", { layout: tokenTable, check: tokenTableProblems });
register("palette", { layout: palette, check: paletteProblems, names: paletteNames });
register("spacingScale", { layout: spacingScale, check: spacingProblems, names: stepNames });
register("typeScale", { layout: typeScale, check: typeProblems, names: stepNames });
register("table", { layout: table, check: tableProblems, names: tableNames });
