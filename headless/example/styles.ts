import * as css from "cssints/clay" with { type: "cssints" };

// The styles of a switch for headless/README.md. A Clay style has no states and no checked flag: a state is a style of
// its own (`track_active`), and the checked look is another style the page picks from `part.checked`.
export const t = css.createTokens({
  color: {
    $type: "color",
    off: { $value: "rgb(60 64 78)" },
    on: { $value: "rgb(240 140 50)" },
    pressed: { $value: "rgb(255 200 120)" },
  },
});

export const track = css.cn(
  css.width(44),
  css.height(24),
  css.borderRadius(12),
  css.bg(t.color.off),
  css.active(css.bg(t.color.pressed)),
);
export const trackOn = css.cn(track, css.bg(t.color.on));
