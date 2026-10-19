import * as css from "cssints/clay" with { type: "cssints" };

// The styles of the Widgets page. Clay has no checked or disabled flag: the page picks `track` or `trackOn`, `box`,
// `boxOn`, `boxMixed` or `boxDisabled` from the part's fields, and `:hover`, `:active` and `:focus` are the hover and pressed looks and the
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
    // hover and pressed lift the surface a step each, so the ink keeps its contrast (dark 10.3:1 and 7.9:1)
    hover: { $value: "rgb(48 53 68)" },
    active: { $value: "rgb(64 70 90)" },
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
    hover: "rgb(232 235 241)",
    active: "rgb(216 221 231)",
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
  css.hover(css.bg(t.color.hover)),
  css.active(css.bg(t.color.active)),
  css.focus(css.border(2, t.color.ring)),
);

// the clickable, focusable row of a switch, a checkbox or a disclosure trigger
export const row = css.cn(
  css.width("stretch"),
  css.p(4, 10),
  css.gap(12),
  css.alignItems("center"),
  css.borderRadius(8),
  css.hover(css.bg(t.color.hover)),
  css.active(css.bg(t.color.active)),
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

// radio, tabs, slider, toolbar: the same tokens and states. Which look a part has (`radioOn`, `tabOn`, `ledOn`) is picked
// from its fields; the slider's `fill` is the one style the page derives, with the width of the value.
export const field = css.cn(css.width("stretch"), css.p(0, 0, 0, 10), css.gap(4), css.alignItems("center"));
export const caption = css.cn(css.width(64));

// a radio: a ring that holds a dot when checked, in a row that takes the focus ring
export const choice = css.cn(
  css.p(4, 8),
  css.gap(8),
  css.alignItems("center"),
  css.borderRadius(8),
  css.hover(css.bg(t.color.hover)),
  css.active(css.bg(t.color.active)),
  css.focus(css.border(2, t.color.ring)),
);
export const radio = css.cn(
  css.width(18),
  css.height(18),
  css.borderRadius(9),
  css.border(2, t.color.muted),
  css.justifyContent("center"),
  css.alignItems("center"),
);
export const radioOn = css.cn(radio, css.borderColor(t.color.accent));
export const radioDisabled = css.cn(radio, css.borderColor(t.color.disabled));
export const dot = css.cn(css.width(8), css.height(8), css.borderRadius(4), css.bg(t.color.accent));

// tabs: the selected tab shares the panel's surface and has an accent line under it
export const tabsBox = css.cn(css.width("stretch"), css.flexDirection("column"));
export const tablist = css.cn(css.gap(2));
export const tab = css.cn(
  css.p(7, 16),
  css.borderRadius(8, 8, 0, 0),
  css.hover(css.bg(t.color.hover)),
  css.active(css.bg(t.color.active)),
  css.focus(css.border(2, t.color.ring)),
);
export const tabOn = css.cn(tab, css.bg(t.color.surface), css.borderWidth(0, 0, 2, 0), css.borderColor(t.color.accent));
export const tabPanel = css.cn(
  css.width("stretch"),
  css.height(58),
  css.p(10, 14),
  css.gap(2),
  css.flexDirection("column"),
  css.bg(t.color.surface),
  css.borderRadius(8),
  css.focus(css.border(2, t.color.ring)),
);

// a slider: a rail to click on, the filled part, the knob, the rest of the rail
export const rail = css.cn(css.width(140), css.height(24), css.alignItems("center"));
export const fill = css.cn(css.height(4), css.borderRadius(2), css.bg(t.color.accent));
export const slack = css.cn(css.width("stretch"), css.height(4), css.borderRadius(2), css.bg(t.color.off));
export const knob = css.cn(
  css.width(16),
  css.height(16),
  css.borderRadius(8),
  css.bg(t.color.thumb),
  css.border(2, t.color.muted),
  css.focus(css.border(2, t.color.ring)),
);
export const readout = css.cn(css.width(44), css.justifyContent("flex-end"));

// a toolbar of toggle buttons: a lamp under the label says on or off
export const tools = css.cn(css.width("stretch"), css.p(0, 10), css.gap(6));
export const tool = css.cn(
  css.p(5, 12),
  css.gap(3),
  css.flexDirection("column"),
  css.bg(t.color.surface),
  css.borderRadius(8),
  css.border(1, t.color.muted),
  css.hover(css.bg(t.color.hover)),
  css.active(css.bg(t.color.active)),
  css.focus(css.border(2, t.color.ring)),
);
export const led = css.cn(css.width("stretch"), css.height(3), css.borderRadius(2), css.bg(t.color.off));
export const ledOn = css.cn(led, css.bg(t.color.accent));
