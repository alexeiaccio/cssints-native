import * as css from "cssints/clay" with { type: "cssints" };

// The Sensors page of esp32's clay-test (ui.c page_sensors, inside ui_frame's Root), its values copied from there.
// The colours are tokens; the light theme (styles.h: every style again as `<name>_light`) is page.c's THEME=light.
// Tokens and themes come first: a style sees the themes declared before it.
export const t = css.createTokens({
  color: {
    $type: "color",
    page: { $value: "rgb(16 18 24)" },
    title: { $value: "rgb(230 60 60)" },
    muted: { $value: "rgb(150 155 170)" },
    ink: { $value: "rgb(235 235 240)" },
    accent: { $value: "rgb(240 140 50)" },
    surface: { $value: "rgb(36 40 52)" },
    // hover and pressed lift the surface a step each, so the ink keeps its contrast (dark 10.3:1 and 7.9:1)
    hover: { $value: "rgb(48 53 68)" },
    active: { $value: "rgb(64 70 90)" },
  },
});
css.createGlobalTheme(t, "light", {
  color: {
    page: "rgb(244 245 248)",
    title: "rgb(200 30 40)",
    muted: "rgb(95 100 115)",
    ink: "rgb(25 27 34)",
    accent: "rgb(190 90 10)",
    surface: "rgb(255 255 255)",
    hover: "rgb(232 235 241)",
    active: "rgb(216 221 231)",
  },
});
// the order of host.c's font array
export const font = css.fonts("Roboto");

export const root = css.cn(
  css.width("stretch"),
  css.height("stretch"),
  css.p(40, 64, 56, 64),
  css.gap(8),
  css.flexDirection("column"),
  css.alignItems("center"),
  css.bg(t.color.page),
);
export const title = css.cn(font.Roboto, css.color(t.color.title), css.fontSize(32));
export const caption = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(14));
export const value = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(20));
export const magnitude = css.cn(font.Roboto, css.color(t.color.accent), css.fontSize(20));
export const units = css.cn(
  css.width(200),
  css.height(38),
  css.justifyContent("center"),
  css.alignItems("center"),
  css.bg(t.color.surface),
  css.borderRadius(19),
  css.border(1, t.color.muted),
  css.hover(css.bg(t.color.hover)),
  css.active(css.bg(t.color.active)),
);
export const unitsLabel = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(14));
// The IMAGE=1 variant's picture: the path is imageData, which the desktop ThorVG renderer loads; the 32x32 glyph is
// its own size here, and `contain` keeps its proportions in a box another style would grow
export const glyph = css.image("examples/sensors/glyph.png", { width: 32, height: 32, fit: "contain" });
