import * as css from "cssints/clay" with { type: "cssints" };

// The Units pill of esp32's clay-test (ui.c), the element flashed and checked on the board on 2026-10-19.
export const units = css.cn(
  css.width(200),
  css.height(38),
  css.justifyContent("center"),
  css.alignItems("center"),
  css.bg("rgb(36 40 52)"),
  css.borderRadius(19),
  css.border(1, "rgb(150 155 170)"),
);
