import * as css from "cssints/clay" with { type: "cssints" };

// The Sensors page of esp32's clay-test (ui.c page_sensors, inside ui_frame's Root), its values copied from there.
export const root = css.cn(
  css.width("stretch"),
  css.height("stretch"),
  css.p(40, 64, 56, 64),
  css.gap(8),
  css.flexDirection("column"),
  css.alignItems("center"),
  css.bg("rgb(16 18 24)"),
);
export const title = css.cn(css.color("rgb(230 60 60)"), css.fontSize(32));
export const caption = css.cn(css.color("rgb(150 155 170)"), css.fontSize(14));
export const value = css.cn(css.color("rgb(235 235 240)"), css.fontSize(20));
export const magnitude = css.cn(css.color("rgb(240 140 50)"), css.fontSize(20));
export const units = css.cn(
  css.width(200),
  css.height(38),
  css.justifyContent("center"),
  css.alignItems("center"),
  css.bg("rgb(36 40 52)"),
  css.borderRadius(19),
  css.border(1, "rgb(150 155 170)"),
);
export const unitsDown = css.bg("rgb(255 200 120)");
export const unitsLabel = css.cn(css.color("rgb(235 235 240)"), css.fontSize(14));
