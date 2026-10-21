// apps/csssky-tui's styles.ts (css-in-ts-compiler, read only) as cssints/clay can express it: the same tokens, the same
// declarations, the same state names. Compiled by generator/clay-header.ts into sky_styles.h.
//
// Four things the tui member set has and Clay's does not, and what a cell does instead:
//   css.fontWeight("bold")      a cell has one weight: the terminal's bold would be an attribute, not a style
//   css.textDecoration(...)     links are the link colour only, no underline
//   css.cursor("pointer")       no pointer shape in a cell grid (termbox2 has no OSC 22)
//   css.flexShrink / flexGrow   the page is a column whose middle child stretches, as the tui's list does
// `border("rounded", ...)` is `border(1, ...)`: a corner radius is a square corner in a cell (docs/map.md step 6).
import * as css from "cssints/clay" with { type: "cssints" };

export const c = css.createTokens({
  color: {
    $type: "color",
    bg: { $value: "#101316" },
    card: { $value: "#171b20" },
    hover: { $value: "#222831" },
    text: { $value: "#e6e9ec" },
    muted: { $value: "#8b98a5" },
    border: { $value: "#323a44" },
    accent: { $value: "#3b9cf0" },
    link: { $value: "#5cb0ff" },
    onAccent: { $value: "#ffffff" },
  },
});
css.createGlobalTheme(c, "light", {
  color: {
    bg: "#f3f5f7",
    card: "#ffffff",
    hover: "#e8eef4",
    text: "#0f1419",
    muted: "#56636f",
    border: "#cfd8df",
    accent: "#1170cf",
    link: "#0b62bd",
  },
});

export const screen = css.cn(css.flexDirection("column"), css.width("100%"), css.height("100%"), css.bg(c.color.bg));
export const bar = css.cn(css.flexDirection("row"), css.width("100%"), css.gap(2), css.p(0, 1), css.bg(c.color.card));
export const tab = css.cn(
  css.color(c.color.muted),
  css.bg(c.color.card),
  css.hover(css.color(c.color.text), css.bg(c.color.hover)),
);
export const tabActive = css.cn(css.color(c.color.onAccent), css.bg(c.color.accent));
export const list = css.cn(
  css.flexDirection("column"),
  css.width("100%"),
  css.height("stretch"),
  css.bg(c.color.bg),
  css.overflow("hidden"),
);
export const footer = css.cn(css.width("100%"), css.color(c.color.muted), css.bg(c.color.card), css.p(0, 1));

// A row of a list: the selected one has the keyboard focus and the accent border.
export const row = css.cn(
  css.flexDirection("column"),
  css.width("100%"),
  css.border(1, c.color.border),
  css.bg(c.color.card),
  css.p(0, 1),
  // a cell card cuts what does not fit: the body is one row here, not the wrap the app does
  css.overflow("hidden"),
  css.focus(css.borderColor(c.color.accent)),
);
export const card = css.cn(row, css.hover(css.bg(c.color.hover)));
export const quote = css.cn(css.flexDirection("column"), css.border(1, c.color.border), css.p(0, 1));
export const body = css.color(c.color.text);
export const muted = css.color(c.color.muted);

export const title = css.color(c.color.accent);
export const name = css.color(c.color.text);
export const meta = css.color(c.color.muted);
export const link = css.color(c.color.link);
export const tag = css.color(c.color.link);
