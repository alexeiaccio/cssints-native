import * as css from "cssints/clay" with { type: "cssints" };

// The styles of the inline-demo page, in the old way: a separate `styles.ts` next to the markup. InlineDemo.tsx holds
// the same declarations inline; the two pages must render the same frame (solid/inline.test.ts).
export const t = css.createTokens({
  color: {
    $type: "color",
    page: { $value: "rgb(16 18 24)" },
    surface: { $value: "rgb(36 40 52)" },
    ink: { $value: "rgb(235 235 240)" },
    muted: { $value: "rgb(150 155 170)" },
    accent: { $value: "rgb(240 140 50)" },
    ring: { $value: "rgb(90 170 255)" },
    hover: { $value: "rgb(48 53 68)" },
    active: { $value: "rgb(64 70 90)" },
  },
});
css.createGlobalTheme(t, "light", {
  color: {
    page: "rgb(244 245 248)",
    surface: "rgb(255 255 255)",
    ink: "rgb(25 27 34)",
    muted: "rgb(95 100 115)",
    accent: "rgb(190 90 10)",
    ring: "rgb(20 100 220)",
    hover: "rgb(232 235 241)",
    active: "rgb(216 221 231)",
  },
});
export const font = css.fonts("Roboto");

// `card` is nested into `panel` and the chips are composed from it: the vocabulary the inline page must keep
const card = css.cn(
  css.p(16),
  css.gap(8),
  css.flexDirection("column"),
  css.borderRadius(12),
  css.bg(t.color.surface),
);
export const panel = css.cn(card, css.border(1, t.color.muted));
export const root = css.cn(
  css.width("stretch"),
  css.height("stretch"),
  css.p(24, 32),
  css.gap(12),
  css.flexDirection("column"),
  css.bg(t.color.page),
);
export const title = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(28));
export const caption = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(14));
export const value = css.cn(font.Roboto, css.color(t.color.accent), css.fontSize(20));
export const label = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(16));
export const row = css.cn(css.width("stretch"), css.gap(8), css.alignItems("center"));
export const chip = css.cn(
  font.Roboto,
  css.color(t.color.ink),
  css.fontSize(14),
  css.p(4, 10),
  css.borderRadius(8),
  css.bg(t.color.surface),
  css.border(1, t.color.muted),
);
export const chipOn = css.cn(chip, css.bg(t.color.accent));
export const button = css.cn(
  css.width("stretch"),
  font.Roboto,
  css.color(t.color.ink),
  css.fontSize(16),
  css.height(40),
  css.justifyContent("center"),
  css.alignItems("center"),
  css.bg(t.color.surface),
  css.borderRadius(20),
  css.border(1, t.color.muted),
  css.hover(css.bg(t.color.hover)),
  css.active(css.bg(t.color.active)),
  css.focus(css.border(2, t.color.ring)),
);
