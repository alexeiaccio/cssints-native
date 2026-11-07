// The text sheet: one page of the strings, sizes and weights the app draws, for the text oracle (text-oracle.ts) and its
// metric (text.test.ts). Every row is a box of the same height and a text at its top-left, so a row's bounds are both the
// crop the metric reads and the place the oracle draws the same string in CoreText. Nothing moves, nothing animates: the
// frame is the same on every run.
import * as css from "cssints/clay" with { type: "cssints" };

const t = css.createTokens({
  color: { page: { $type: "color", $value: "rgb(16 18 24)" }, ink: { $type: "color", $value: "rgb(235 235 240)" } },
});
const font = css.fonts("Roboto");
const root = css.cn(
  css.width("stretch"),
  css.height("stretch"),
  css.p(20, 16),
  css.gap(4),
  css.flexDirection("column"),
  css.bg(t.color.page),
);
const row = css.cn(css.width("stretch"), css.height(40));
// one class per size: a style is static, so the map is literal calls
const text = {
  11: css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(11)),
  12: css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(12)),
  13: css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(13)),
  14: css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(14)),
  16: css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(16)),
  17: css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(17)),
  20: css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(20)),
  24: css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(24)),
  32: css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(32)),
};

/** A line of the sheet: the string, its size, and the id of the row box that holds it (the metric's crop). */
export interface SheetRow {
  readonly id: string;
  readonly text: string;
  readonly size: 11 | 12 | 13 | 14 | 16 | 17 | 20 | 24 | 32;
}
/**
 * The lines, worst case first-ish: a 13-row page covers the eight sizes and the shapes the app draws — titles, a long
 * mixed-case run, digits and a minus, a superscript, a degree sign, a quote and a fraction, and the letters whose
 * descenders and ascenders are what a thin rasteriser loses first.
 */
export const ROWS: readonly SheetRow[] = [
  { id: "sheet-0", text: "Sensors", size: 32 },
  { id: "sheet-1", text: "Network & Sharing", size: 24 },
  { id: "sheet-2", text: "+1.16  -0.72  +10.04", size: 20 },
  { id: "sheet-3", text: "Wm ¼ ⅓ — “quotes”", size: 20 },
  { id: "sheet-4", text: "18.3 °C", size: 17 },
  { id: "sheet-5", text: "Room A1", size: 16 },
  { id: "sheet-6", text: "The quick brown fox", size: 16 },
  { id: "sheet-7", text: "switch to g", size: 14 },
  { id: "sheet-8", text: "accel m/s²", size: 14 },
  { id: "sheet-9", text: "18.3 °C", size: 13 },
  { id: "sheet-10", text: "gjpqy 0123456789", size: 12 },
  { id: "sheet-11", text: "settings", size: 11 },
];

/** 20 + 16 of padding, twelve 40px rows and their 4px gaps: 20 + 12·40 + 11·4 + 20 = 564. */
export const size = { width: 440, height: 564 };

/** The page: the rows in order, each a box and its line. */
export function Sheet() {
  return (
    <box style={root}>
      {ROWS.map((r) => (
        <box id={r.id} style={row}>
          <text style={text[r.size]}>{r.text}</text>
        </box>
      ))}
    </box>
  );
}
