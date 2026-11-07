// The Figure page's palette and styles, in a module of its own so the focus's roles are tokens of the same
// `createTokens` the rest of the native pages use. Every colour a figure draws is a role: `ink` for the data's text,
// `muted` for its source and its arrows, `accent` for a bar's fill, `line` for the empty part of a track, and
// `problem`/`good` for a focus's tone. `probe` is the same two roles as a style with nothing else in it, which
// solid/figure.test.ts reads in both themes: a focus style that followed a literal colour would not change with the
// theme, and the probe's would (the token assertion).
import * as css from "cssints/clay" with { type: "cssints" };

const DARK = {
  page: "rgb(16 19 22)",
  panel: "rgb(27 32 38)",
  ink: "rgb(230 233 236)",
  muted: "rgb(139 152 165)",
  accent: "rgb(59 156 240)",
  line: "rgb(45 51 61)",
  problem: "rgb(230 60 60)",
  good: "rgb(90 190 120)",
  shade0: "rgb(45 51 61)",
  shade1: "rgb(90 100 112)",
  shade2: "rgb(139 152 165)",
  shade3: "rgb(230 233 236)",
} as const;
const LIGHT = {
  page: "rgb(243 245 247)",
  panel: "rgb(255 255 255)",
  ink: "rgb(15 20 25)",
  muted: "rgb(86 99 111)",
  accent: "rgb(17 112 207)",
  line: "rgb(213 220 228)",
  problem: "rgb(190 30 40)",
  good: "rgb(20 130 70)",
  shade0: "rgb(213 220 228)",
  shade1: "rgb(170 180 190)",
  shade2: "rgb(86 99 111)",
  shade3: "rgb(15 20 25)",
} as const;

export const t = css.createTokens({
  color: {
    $type: "color",
    page: { $value: DARK.page },
    panel: { $value: DARK.panel },
    ink: { $value: DARK.ink },
    muted: { $value: DARK.muted },
    accent: { $value: DARK.accent },
    line: { $value: DARK.line },
    problem: { $value: DARK.problem },
    good: { $value: DARK.good },
    shade0: { $value: DARK.shade0 },
    shade1: { $value: DARK.shade1 },
    shade2: { $value: DARK.shade2 },
    shade3: { $value: DARK.shade3 },
  },
});
css.createGlobalTheme(t, "light", { color: { ...LIGHT } });
export const font = css.fonts("Roboto");

// The text roles: one style a paint, so a focus moves a row's colour and never its geometry (a style is a literal, so
// each is written out: cssints evaluates a `.styles.ts` module once and a helper's parameter is not a value it can fold)
const title = css.cn(
  font.Roboto,
  css.color(t.color.ink),
  css.fontSize(16),
  css.lineHeight(16),
  css.whiteSpace("nowrap"),
);
const muted = css.cn(
  font.Roboto,
  css.color(t.color.muted),
  css.fontSize(12),
  css.lineHeight(16),
  css.whiteSpace("nowrap"),
);
const ink = css.cn(
  font.Roboto,
  css.color(t.color.ink),
  css.fontSize(13),
  css.lineHeight(16),
  css.whiteSpace("nowrap"),
);
const problem = css.cn(
  font.Roboto,
  css.color(t.color.problem),
  css.fontSize(13),
  css.lineHeight(16),
  css.whiteSpace("nowrap"),
);
const good = css.cn(
  font.Roboto,
  css.color(t.color.good),
  css.fontSize(13),
  css.lineHeight(16),
  css.whiteSpace("nowrap"),
);

// A type scale's specimen is drawn at its own size: one style a size of the app's own scale (apps/docs/src/tokens.json's
// fontSize), its line height the same, so a 40px row is a 40px text in a 48px line. A size the figure has no style for
// draws at the ink's, which is what the layout's `size` is there to make visible.
const typeSize = {
  12: css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(12), css.lineHeight(12), css.whiteSpace("nowrap")),
  14: css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(14), css.lineHeight(14), css.whiteSpace("nowrap")),
  16: css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(16), css.lineHeight(16), css.whiteSpace("nowrap")),
  18: css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(18), css.lineHeight(18), css.whiteSpace("nowrap")),
  22: css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(22), css.lineHeight(22), css.whiteSpace("nowrap")),
  28: css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(28), css.lineHeight(28), css.whiteSpace("nowrap")),
  40: css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(40), css.lineHeight(40), css.whiteSpace("nowrap")),
} as const;
// ... and the cell a specimen sits in: as tall as its line, so a 40px "Aa" is at its row's top and not centred in a
// 16px box (which would reach into the row above it)
const typeCell = {
  12: css.cn(css.height(12), css.flexDirection("row")),
  14: css.cn(css.height(14), css.flexDirection("row")),
  16: css.cn(css.height(16), css.flexDirection("row")),
  18: css.cn(css.height(18), css.flexDirection("row")),
  22: css.cn(css.height(22), css.flexDirection("row")),
  28: css.cn(css.height(28), css.flexDirection("row")),
  40: css.cn(css.height(40), css.flexDirection("row")),
} as const;

// The root: the window, the page's fill and the figure's two cells of side padding and one row above and below
const root = css.cn(
  css.width("stretch"),
  css.height("stretch"),
  css.p(16, 16),
  css.flexDirection("column"),
  css.bg(t.color.page),
);
// a line: one row of the cell grid, and no gap, so a line is 16px and a bar lands on a row. The height is the style's
// default; a kind whose rows are taller (a type scale's 40px line is three cells) writes each line's own height through
// the value channel, as every item's width is written.
const line = css.cn(css.width("stretch"), css.height(16), css.flexDirection("row"));
// a cell: a box whose width the page writes (the layout's cells), and its text at the left of it
const cell = css.cn(css.height(16), css.flexDirection("row"), css.alignItems("center"));
// a flow's box: the panel's fill and one cell of left padding, so its label starts a cell in
const box = css.cn(cell, css.bg(t.color.panel), css.paddingLeft(8));
// a bar's track: the empty part of the scale, at the line role; its fill is a child, and its width is the value's
const track = css.cn(css.height(16), css.bg(t.color.line));
const fill = {
  plain: css.cn(css.height(16), css.bg(t.color.accent)),
  problem: css.cn(css.height(16), css.bg(t.color.problem)),
  good: css.cn(css.height(16), css.bg(t.color.good)),
};
// a palette's two: a swatch is its step's own colour (the page writes r, g, b; the style's alpha is what keeps the
// override from being invisible), and a marker is glyph-kit's ▲ as a cell of the `good` role — Roboto has no ▲, so the
// pixel targets draw a mark and the text half draws the glyph.
const swatch = css.cn(cell, css.bg(t.color.line));
const marker = css.cn(cell, css.bg(t.color.good));
// a sparkline's point: a cell whose bar is written tall as the point's eighth and stands on the line's floor (the bar is
// bottom-aligned in its cell), and the glyph the terminal and the text half print (Roboto has no ▁, so a pixel target
// draws the bar and the glyph is the text command the terminal's row is compared by)
const sparkCell = css.cn(css.height(16), css.flexDirection("row"), css.alignItems("flex-end"));
const sparkBar = css.cn(css.width("stretch"), css.bg(t.color.accent));
const sparkGlyph = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(8), css.lineHeight(8), css.whiteSpace("nowrap"));
// a heatmap's cell: one of four shades, the ramp a value's WCAG band is drawn at
const shade = {
  0: css.cn(css.height(16), css.bg(t.color.shade0)),
  1: css.cn(css.height(16), css.bg(t.color.shade1)),
  2: css.cn(css.height(16), css.bg(t.color.shade2)),
  3: css.cn(css.height(16), css.bg(t.color.shade3)),
};
const text = { title, muted, ink, problem, good };

// the token probe the invariant test reads: the two focus roles with nothing else, in both themes
export const probe = {
  problem: css.cn(css.color(t.color.problem)),
  good: css.cn(css.color(t.color.good)),
  ink: css.cn(css.color(t.color.ink)),
};

export const s = { t, font, root, line, cell, box, track, fill, swatch, marker, sparkCell, sparkBar, sparkGlyph, shade, typeSize, typeCell, text };
