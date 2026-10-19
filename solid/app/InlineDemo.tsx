// The inline-demo page: the same styles as inline-demo.styles.ts, declared in this file next to the markup that uses
// them. `solid/plugin.ts` compiles it: JSX first (stage 1), then the cssints Vite plugin on the plain JS (stage 2).
import * as css from "cssints/clay" with { type: "cssints" };
import { createSignal } from "solid-js";

const t = css.createTokens({
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
const font = css.fonts("Roboto");

const card = css.cn(
  css.p(16),
  css.gap(8),
  css.flexDirection("column"),
  css.borderRadius(12),
  css.bg(t.color.surface),
);
const panel = css.cn(card, css.border(1, t.color.muted));
const root = css.cn(
  css.width("stretch"),
  css.height("stretch"),
  css.p(24, 32),
  css.gap(12),
  css.flexDirection("column"),
  css.bg(t.color.page),
);
const title = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(28));
const caption = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(14));
const value = css.cn(font.Roboto, css.color(t.color.accent), css.fontSize(20));
const label = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(16));
const row = css.cn(css.width("stretch"), css.gap(8), css.alignItems("center"));
const chip = css.cn(
  font.Roboto,
  css.color(t.color.ink),
  css.fontSize(14),
  css.p(4, 10),
  css.borderRadius(8),
  css.bg(t.color.surface),
  css.border(1, t.color.muted),
);
const chipOn = css.cn(chip, css.bg(t.color.accent));
const button = css.cn(
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

export function InlineDemo(props: { focus?: boolean }) {
  const [count, setCount] = createSignal(0);
  return (
    <box id="Root" style={root}>
      <text style={title}>Inline styles</text>
      <box style={panel}>
        <text style={caption}>the styles live next to the markup</text>
        <text style={value}>{`Presses: ${count()}`}</text>
        <box style={row}>
          <box style={chip}>
            <text style={caption}>composed</text>
          </box>
          <box style={chipOn}>
            <text style={caption}>token</text>
          </box>
        </box>
      </box>
      <box id="press" style={button} focused={props.focus} onClick={() => setCount((n) => n + 1)}>
        <text style={label}>Press</text>
      </box>
    </box>
  );
}
