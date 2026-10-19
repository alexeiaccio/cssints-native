import * as css from "cssints/clay" with { type: "cssints" };

// The styles of the Widgets page. Clay has no checked or disabled flag: the page picks `track` or `trackOn`, `box`,
// `boxOn`, `boxMixed` or `boxDisabled` from the part's fields, and `:active` and `:focus` are the pressed look and the
// focus ring, laid over the style by the renderer (the ring over the pressed look over the base).
export const t = css.createTokens({
  color: {
    $type: "color",
    page: { $value: "rgb(16 18 24)" },
    title: { $value: "rgb(230 60 60)" },
    muted: { $value: "rgb(150 155 170)" },
    ink: { $value: "rgb(235 235 240)" },
    off: { $value: "rgb(60 64 78)" },
    accent: { $value: "rgb(240 140 50)" },
    surface: { $value: "rgb(36 40 52)" },
    pressed: { $value: "rgb(255 200 120)" },
    ring: { $value: "rgb(90 170 255)" },
    thumb: { $value: "rgb(255 255 255)" },
    disabled: { $value: "rgb(88 92 106)" },
  },
});
css.createGlobalTheme(t, "light", {
  color: {
    page: "rgb(244 245 248)",
    title: "rgb(200 30 40)",
    muted: "rgb(95 100 115)",
    ink: "rgb(25 27 34)",
    off: "rgb(190 194 206)",
    accent: "rgb(190 90 10)",
    surface: "rgb(255 255 255)",
    pressed: "rgb(255 210 150)",
    ring: "rgb(20 100 220)",
    thumb: "rgb(255 255 255)",
    disabled: "rgb(170 174 186)",
  },
});
export const font = css.fonts("Roboto");

export const root = css.cn(
  css.width("stretch"),
  css.height("stretch"),
  css.p(28, 40, 24, 40),
  css.gap(6),
  css.flexDirection("column"),
  css.bg(t.color.page),
);
export const title = css.cn(font.Roboto, css.color(t.color.title), css.fontSize(32));
export const label = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(16));
export const labelDisabled = css.cn(font.Roboto, css.color(t.color.disabled), css.fontSize(16));
export const note = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(14));
export const mark = css.cn(font.Roboto, css.color(t.color.accent), css.fontSize(18));

// a command button: the pill of Sensors
export const button = css.cn(
  css.width("stretch"),
  css.height(40),
  css.justifyContent("center"),
  css.alignItems("center"),
  css.bg(t.color.surface),
  css.borderRadius(20),
  css.border(1, t.color.muted),
  css.active(css.bg(t.color.pressed)),
  css.focus(css.border(2, t.color.ring)),
);

// the clickable, focusable row of a switch, a checkbox or a disclosure trigger
export const row = css.cn(
  css.width("stretch"),
  css.p(4, 10),
  css.gap(12),
  css.alignItems("center"),
  css.borderRadius(8),
  css.active(css.bg(t.color.surface)),
  css.focus(css.border(2, t.color.ring)),
);
export const rowIndented = css.cn(row, css.pl(34));

export const track = css.cn(
  css.width(44),
  css.height(24),
  css.p(2),
  css.borderRadius(12),
  css.alignItems("center"),
  css.justifyContent("flex-start"),
  css.bg(t.color.off),
);
export const trackOn = css.cn(track, css.bg(t.color.accent), css.justifyContent("flex-end"));
export const thumb = css.cn(css.width(20), css.height(20), css.borderRadius(10), css.bg(t.color.thumb));

export const box = css.cn(
  css.width(20),
  css.height(20),
  css.borderRadius(4),
  css.border(2, t.color.muted),
  css.justifyContent("center"),
  css.alignItems("center"),
);
export const boxOn = css.cn(box, css.bg(t.color.accent), css.borderColor(t.color.accent));
export const boxDisabled = css.cn(box, css.borderColor(t.color.disabled));
export const tick = css.cn(css.width(10), css.height(10), css.borderRadius(2), css.bg(t.color.thumb));
export const dash = css.cn(css.width(10), css.height(3), css.borderRadius(1), css.bg(t.color.thumb));

export const panel = css.cn(
  css.width("stretch"),
  css.p(10, 14),
  css.bg(t.color.surface),
  css.borderRadius(8),
);
