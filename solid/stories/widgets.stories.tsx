// The native stories: headless parts, drawn by the renderer, wired to the host's input. A story's `render` receives the
// storybook's own `input` (and `motion`) as args — the host's keyboard and pointer are the page's, and a story that needs
// them asks for them by name. The styles are literals rather than `createTokens`: one native process compiles every module
// it imports, and two token sets that declare `--color-surface` stop the build (the pages each declare their own).
//
// Each story declares the controls its args get (`argTypes`, per story: the panel is the storybook's, and a story that
// declares nothing gets no panel). An arg is the story's starting state — a switch's `on`, a slider's `volume` — so a
// control that moves one mounts the story again with it. A widget's own state is the widget's (flipping the story's
// switch does not write the arg back: the arg is what the story was rendered with, as in Storybook).
import * as css from "cssints/clay" with { type: "cssints" };

import type { Meta, Story } from "@cssints/stories";

import { createDisclosure, createRadioGroup, createSlider, createSwitch } from "../../headless/src/index.ts";
import { a11y } from "../a11y.ts";
import type { Input } from "../src/input.ts";
import type { Node } from "../src/renderer.ts";

const font = css.fonts("Roboto");
const ink = css.cn(font.Roboto, css.color("rgb(235 235 240)"), css.fontSize(15));
const muted = css.cn(font.Roboto, css.color("rgb(150 155 170)"), css.fontSize(13));
const column = css.cn(css.width("stretch"), css.gap(8), css.flexDirection("column"));

const track = css.cn(
  css.width(56),
  css.height(30),
  css.p(4),
  css.alignItems("center"),
  css.justifyContent("flex-start"),
  css.borderRadius(15),
  css.bg("rgb(60 64 78)"),
  css.focus(css.border(2, "rgb(90 170 255)")),
);
const trackOn = css.cn(track, css.bg("rgb(240 140 50)"), css.justifyContent("flex-end"));
const thumb = css.cn(css.width(22), css.height(22), css.borderRadius(11), css.bg("rgb(255 255 255)"));

const trigger = css.cn(
  css.width("stretch"),
  css.p(10, 12),
  css.borderRadius(8),
  css.bg("rgb(36 40 52)"),
  css.hover(css.bg("rgb(48 53 68)")),
  css.focus(css.border(2, "rgb(90 170 255)")),
);
const panel = css.cn(
  css.width("stretch"),
  css.p(10, 12),
  css.borderRadius(8),
  css.bg("rgb(36 40 52)"),
);

// a radio: a ring with a dot, in a row that takes the focus ring (the Widgets page's Speed group)
const choice = css.cn(
  css.p(4, 8),
  css.gap(8),
  css.alignItems("center"),
  css.borderRadius(8),
  css.hover(css.bg("rgb(48 53 68)")),
  css.focus(css.border(2, "rgb(90 170 255)")),
);
const ring = css.cn(
  css.width(18),
  css.height(18),
  css.borderRadius(9),
  css.border(2, "rgb(150 155 170)"),
  css.justifyContent("center"),
  css.alignItems("center"),
);
const ringOn = css.cn(ring, css.borderColor("rgb(240 140 50)"));
const dot = css.cn(css.width(8), css.height(8), css.borderRadius(4), css.bg("rgb(240 140 50)"));

// a slider (the Widgets page's Volume): the row is the rail and the value, the rail takes the ring, the fill is the value
const sliderRow = css.cn(css.gap(6), css.alignItems("center"), css.borderRadius(8));
const rail = css.cn(
  css.width(160),
  css.height(24),
  css.alignItems("center"),
  css.borderRadius(8),
  css.focus(css.border(2, "rgb(90 170 255)")),
);
const fill = css.cn(css.height(4), css.borderRadius(2), css.bg("rgb(240 140 50)"));
const slack = css.cn(css.width("stretch"), css.height(4), css.borderRadius(2), css.bg("rgb(60 64 78)"));
const knob = css.cn(
  css.width(16),
  css.height(16),
  css.borderRadius(8),
  css.bg("rgb(255 255 255)"),
  css.border(2, "rgb(150 155 170)"),
);
const readout = css.cn(font.Roboto, css.color("rgb(235 235 240)"), css.fontSize(13));

const SPEEDS = ["1x", "4x", "16x"];
const KNOB = 16;
// the slider's filled part is as wide as its value: one style made at run time, kept per width (the Widgets page's)
const fills = new Map<number, typeof fill>();
const fillOf = (w: number): typeof fill => {
  let style = fills.get(w);
  if (!style) {
    const base = fill as any;
    const width = { type: "FIXED", min: w, max: w };
    fills.set(w, (style = { ...base, layout: { ...base.layout, sizing: { ...base.layout.sizing, width } } }));
  }
  return style!;
};

const meta = { title: "Widgets" } satisfies Meta<Record<string, unknown>, Node>;
export default meta;

export const Disclosure: Story<Record<string, unknown>, Node> = {
  args: { open: false },
  argTypes: { open: { type: "boolean" } },
  render: (args) => {
    const more = createDisclosure({
      id: "story-disclosure",
      defaultValue: args["open"] === true,
    });
    const bind = (args["input"] as Input).add(more.trigger);
    return (
      <box style={column}>
        <text style={ink}>A disclosure</text>
        <box {...bind} {...a11y(more.trigger)} style={trigger}>
          <text style={ink}>{more.expanded() ? "Close" : "Open"}</text>
        </box>
        {more.expanded() ? (
          <box style={panel}>
            <text style={muted}>The panel shows while the trigger is expanded.</text>
          </box>
        ) : null}
      </box>
    );
  },
};

export const Switch: Story<Record<string, unknown>, Node> = {
  args: { on: false, label: "A switch" },
  argTypes: { on: { type: "boolean" }, label: { type: "text" } },
  render: (args) => {
    const sw = createSwitch({ id: "story-switch", defaultValue: args["on"] === true });
    const bind = (args["input"] as Input).add(sw.part);
    return (
      <box style={column}>
        <text style={ink}>{String(args["label"])}</text>
        <text style={muted}>Tab reaches it, Space and Enter flip it.</text>
        <box {...bind} {...a11y(sw.part)} style={sw.checked() ? trackOn : track}>
          <box style={thumb} />
        </box>
      </box>
    );
  },
};

export const Tempo: Story<Record<string, unknown>, Node> = {
  args: { speed: "1x" },
  argTypes: { speed: { type: "select", options: SPEEDS } },
  render: (args) => {
    const group = createRadioGroup({
      id: "story-tempo",
      values: SPEEDS,
      defaultValue: String(args["speed"]),
      focus: (args["input"] as Input).focus,
    });
    const bind = group.radios.map((radio) => (args["input"] as Input).bind(radio));
    return (
      <box style={column}>
        <text style={ink}>A radio group</text>
        <text style={muted}>Up and Down move and check; Tab leaves it.</text>
        <box {...a11y(group.group)} style={column}>
          {group.radios.map((radio, at) => (
            <box {...bind[at]!} {...a11y(radio)} style={choice}>
              <box style={radio.checked ? ringOn : ring}>
                {radio.checked ? <box style={dot} /> : null}
              </box>
              <text style={ink}>{SPEEDS[at]}</text>
            </box>
          ))}
        </box>
      </box>
    );
  },
};

export const Volume: Story<Record<string, unknown>, Node> = {
  args: { volume: 40 },
  argTypes: { volume: { type: "range", min: 0, max: 100, step: 5 } },
  render: (args) => {
    const volume = createSlider({
      id: "story-volume",
      min: 0,
      max: 100,
      step: 5,
      largeStep: 20,
      defaultValue: Number(args["volume"]),
      valueText: (value) => `${value}%`,
      focus: (args["input"] as Input).focus,
    });
    const bind = (args["input"] as Input).bind(volume.thumb);
    return (
      <box style={column}>
        <text style={ink}>A slider</text>
        <text style={muted}>Left and Right change the volume.</text>
        <box {...a11y(volume.thumb)} style={sliderRow}>
          <box focused={bind.focused} style={rail}>
            <box style={fillOf((volume.value() / 100) * (160 - KNOB))} />
            <box style={knob} />
            <box style={slack} />
          </box>
          <text style={readout}>{volume.thumb.valueText}</text>
        </box>
      </box>
    );
  },
};
