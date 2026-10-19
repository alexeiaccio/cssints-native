// The Widgets page: the headless button, switch, checkbox (one of them mixed, one disabled) and disclosure, then a radio
// group, tabs, a slider and a toolbar, with their styles in this file. Each widget's style is picked from its part's fields
// (`checked`, `selected`, `disabled`, `hidden`); the pressed look and the focus ring are the styles' `:active` and
// `:focus`. Every part is registered in the focus manager in document order, so Tab walks them top to bottom; the four
// groups are one stop each (radio, tabs and toolbar are groups of the manager, the slider is one entry).
import * as css from "cssints/clay" with { type: "cssints" };
import { createSignal, Show } from "solid-js";

import {
  createButton,
  createCheckbox,
  createDisclosure,
  createRadioGroup,
  createSlider,
  createSwitch,
  createTabs,
  createToolbar,
  type Checkbox,
} from "../../headless/src/index.ts";
import { ui } from "../src/ffi.ts";
import type { Bind, Input } from "../src/input.ts";

// The styles of the page. Clay has no checked or disabled flag: the page picks `track` or `trackOn`, `box`,
// `boxOn`, `boxMixed` or `boxDisabled` from the part's fields, and `:hover`, `:active` and `:focus` are the hover and
// pressed looks and the focus ring, laid over the style by the renderer (the ring over the pressed look over the base).
const t = css.createTokens({
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
const font = css.fonts("Roboto");

const root = css.cn(
  css.width("stretch"),
  css.height("stretch"),
  css.p(28, 40, 24, 40),
  css.gap(6),
  css.flexDirection("column"),
  css.bg(t.color.page),
);
const title = css.cn(font.Roboto, css.color(t.color.title), css.fontSize(32));
const label = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(16));
const labelDisabled = css.cn(font.Roboto, css.color(t.color.disabled), css.fontSize(16));
const note = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(14));
const mark = css.cn(font.Roboto, css.color(t.color.accent), css.fontSize(18));

// a command button: the pill of Sensors
const button = css.cn(
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
const row = css.cn(
  css.width("stretch"),
  css.p(4, 10),
  css.gap(12),
  css.alignItems("center"),
  css.borderRadius(8),
  css.hover(css.bg(t.color.hover)),
  css.active(css.bg(t.color.active)),
  css.focus(css.border(2, t.color.ring)),
);
const rowIndented = css.cn(row, css.pl(34));

const track = css.cn(
  css.width(44),
  css.height(24),
  css.p(2),
  css.borderRadius(12),
  css.alignItems("center"),
  css.justifyContent("flex-start"),
  css.bg(t.color.off),
);
const trackOn = css.cn(track, css.bg(t.color.accent), css.justifyContent("flex-end"));
const thumb = css.cn(css.width(20), css.height(20), css.borderRadius(10), css.bg(t.color.thumb));

const box = css.cn(
  css.width(20),
  css.height(20),
  css.borderRadius(4),
  css.border(2, t.color.muted),
  css.justifyContent("center"),
  css.alignItems("center"),
);
const boxOn = css.cn(box, css.bg(t.color.accent), css.borderColor(t.color.accent));
const boxDisabled = css.cn(box, css.borderColor(t.color.disabled));
const tick = css.cn(css.width(10), css.height(10), css.borderRadius(2), css.bg(t.color.thumb));
const dash = css.cn(css.width(10), css.height(3), css.borderRadius(1), css.bg(t.color.thumb));

const panel = css.cn(
  css.width("stretch"),
  css.p(10, 14),
  css.bg(t.color.surface),
  css.borderRadius(8),
);

// radio, tabs, slider, toolbar: the same tokens and states. Which look a part has (`radioOn`, `tabOn`, `ledOn`) is picked
// from its fields; the slider's `fill` is the one style the page derives, with the width of the value.
const field = css.cn(css.width("stretch"), css.p(0, 0, 0, 10), css.gap(4), css.alignItems("center"));
const caption = css.cn(css.width(64));

// a radio: a ring that holds a dot when checked, in a row that takes the focus ring
const choice = css.cn(
  css.p(4, 8),
  css.gap(8),
  css.alignItems("center"),
  css.borderRadius(8),
  css.hover(css.bg(t.color.hover)),
  css.active(css.bg(t.color.active)),
  css.focus(css.border(2, t.color.ring)),
);
const radio = css.cn(
  css.width(18),
  css.height(18),
  css.borderRadius(9),
  css.border(2, t.color.muted),
  css.justifyContent("center"),
  css.alignItems("center"),
);
const radioOn = css.cn(radio, css.borderColor(t.color.accent));
const radioDisabled = css.cn(radio, css.borderColor(t.color.disabled));
const dot = css.cn(css.width(8), css.height(8), css.borderRadius(4), css.bg(t.color.accent));

// tabs: the selected tab shares the panel's surface and has an accent line under it
const tabsBox = css.cn(css.width("stretch"), css.flexDirection("column"));
const tablist = css.cn(css.gap(2));
const tab = css.cn(
  css.p(7, 16),
  css.borderRadius(8, 8, 0, 0),
  css.hover(css.bg(t.color.hover)),
  css.active(css.bg(t.color.active)),
  css.focus(css.border(2, t.color.ring)),
);
const tabOn = css.cn(tab, css.bg(t.color.surface), css.borderWidth(0, 0, 2, 0), css.borderColor(t.color.accent));
const tabPanel = css.cn(
  css.width("stretch"),
  css.height(58),
  css.p(10, 14),
  css.gap(2),
  css.flexDirection("column"),
  css.bg(t.color.surface),
  css.borderRadius(8),
  css.focus(css.border(2, t.color.ring)),
);

// a slider: the row that takes the focus ring (the rail and the value, one control), the rail to click on, the filled
// part, the knob, the rest of the rail. The row has no padding or border of its own, so the ring changes no layout and
// the slider looks the same as before when it is not focused.
const sliderRow = css.cn(css.gap(4), css.alignItems("center"), css.borderRadius(8), css.focus(css.border(2, t.color.ring)));
const rail = css.cn(css.width(140), css.height(24), css.alignItems("center"));
const fill = css.cn(css.height(4), css.borderRadius(2), css.bg(t.color.accent));
const slack = css.cn(css.width("stretch"), css.height(4), css.borderRadius(2), css.bg(t.color.off));
const knob = css.cn(
  css.width(16),
  css.height(16),
  css.borderRadius(8),
  css.bg(t.color.thumb),
  css.border(2, t.color.muted),
);
const readout = css.cn(css.width(44), css.justifyContent("flex-end"));

// a toolbar of toggle buttons: a lamp under the label says on or off
const tools = css.cn(css.width("stretch"), css.p(0, 10), css.gap(6));
const tool = css.cn(
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
const led = css.cn(css.width("stretch"), css.height(3), css.borderRadius(2), css.bg(t.color.off));
const ledOn = css.cn(led, css.bg(t.color.accent));

export const s = { t, font, root, title, label, labelDisabled, note, mark, button, row, rowIndented, track, trackOn, thumb, box, boxOn, boxDisabled, tick, dash, panel, field, caption, choice, radio, radioOn, radioDisabled, dot, tabsBox, tablist, tab, tabOn, tabPanel, sliderRow, rail, fill, slack, knob, readout, tools, tool, led, ledOn };

/** The window of the page: the disclosure's panel open still leaves room for the toolbar. */
export const size = { width: 360, height: 608 };

const SPEEDS = ["1x", "4x", "16x"];
const TABS = [
  { name: "Overview", lines: ["Three tabs, three panels.", "Left and Right move and select."] },
  { name: "Stats", lines: ["Home and End go to the first", "and to the last tab."] },
  { name: "Log", lines: ["Tab goes to the panel next,", "then on to the slider."] },
];
const TOOLS = ["Bold", "Italic", "Underline"];
const KNOB = 16;

/** Where the page puts its pointer callback: the host hands it to `createFrame`'s `onPointer` each frame. */
export interface Drag {
  onPointer?: (x: number, y: number, down: boolean) => void;
}

// the slider's filled part is as wide as its value: the one style made at run time, kept per width
const fills = new Map<number, typeof s.fill>();
const fillOf = (w: number): typeof s.fill => {
  let style = fills.get(w);
  if (!style) {
    const base = s.fill as any;
    const width = { type: "FIXED", min: w, max: w };
    fills.set(w, (style = { ...base, layout: { ...base.layout, sizing: { ...base.layout.sizing, width } } }));
  }
  return style!;
};

function Check(props: { cb: Checkbox; bind: Bind; label: string; indented?: boolean }) {
  const checked = () => props.cb.checked();
  return (
    <box {...props.bind} style={props.indented ? s.rowIndented : s.row}>
      <box style={props.cb.disabled() ? s.boxDisabled : checked() === false ? s.box : s.boxOn}>
        <Show when={checked() === true}>
          <box style={s.tick} />
        </Show>
        <Show when={checked() === "mixed"}>
          <box style={s.dash} />
        </Show>
      </box>
      <text style={props.cb.disabled() ? s.labelDisabled : s.label}>{props.label}</text>
    </box>
  );
}

/** `disabledSpeeds`: indices of the radios that are disabled (the page has none; the tests mark one). */
export function Widgets(props: { input: Input; disabledSpeeds?: number[]; drag?: Drag }) {
  const { input } = props;
  const [count, setCount] = createSignal(0);

  const press = createButton({ id: "press", onClick: () => setCount((n) => n + 1) });
  const wifi = createSwitch({ id: "wifi" });
  const wired = createCheckbox({ id: "wired" });
  const wireless = createCheckbox({ id: "wireless" });
  // "Select all" is controlled by its two children: checked when both are, mixed when one is; a request sets both
  const all = createCheckbox({
    id: "all",
    allowMixed: true,
    get value() {
      const a = wired.checked();
      return a === wireless.checked() ? a : "mixed";
    },
    onValueChange: (v) => {
      wired.setChecked(v === true);
      wireless.setChecked(v === true);
    },
  });
  const beta = createCheckbox({ id: "beta", disabled: true });
  const more = createDisclosure({ id: "more" });
  // document order: the order of these calls is the Tab order
  const bind = {
    press: input.add(press.part),
    wifi: input.add(wifi.part),
    all: input.add(all.part),
    wired: input.add(wired.part),
    wireless: input.add(wireless.part),
    beta: input.add(beta.part),
    more: input.add(more.trigger),
  };
  // the groups register their items in the page's manager themselves (`focus`), so they are made after the parts above
  // and in the order of the page: the manager's document order is the order of registration
  const focus = input.focus;
  const speed = createRadioGroup({ id: "speed", values: SPEEDS, defaultValue: "1x", disabled: props.disabledSpeeds, focus });
  const tabs = createTabs({ id: "tabs", items: TABS.length, focus });
  const volume = createSlider({
    id: "volume",
    min: 0,
    max: 100,
    step: 5,
    largeStep: 20,
    defaultValue: 40,
    valueText: (v) => `${v}%`,
    focus,
  });
  const [on, setOn] = createSignal([false, false, false]);
  const format = createToolbar({
    id: "format",
    items: TOOLS,
    focus,
    onActivate: (i) => setOn((a) => a.map((v, j) => (j === i ? !v : v))),
  });

  const groupBind = {
    speed: speed.radios.map((r) => input.bind(r)),
    tabs: tabs.tabs.map((t) => input.bind(t)),
    panels: tabs.panels.map((p) => input.bind(p)),
    volume: input.bind(volume.thumb),
    format: format.items.map((i) => input.bind(i)),
  };

  // a press on the rail (or on the knob, which is inside it) sets the value from where the press was and starts a drag:
  // the rail's bounds from the last layout, the thumb's travel being the rail less the knob, so a press on the knob's
  // middle gives the value the knob shows. While the button is held, every frame moves the value to the pointer's x.
  let dragging = false;
  const setFrom = (x: number) => {
    const [left, , width] = ui.bounds(Buffer.from("volume-rail")) ?? [0, 0, 0];
    if (width! > KNOB) volume.pointer(Math.max(0, Math.min(1, (x - left! - KNOB / 2) / (width! - KNOB))));
  };
  const onRail = (x: number) => {
    dragging = true;
    setFrom(x);
  };
  // the host's frame asks once per frame, before the tree is declared: a release ends the drag, a move follows the
  // pointer. A press that started off the rail never set the flag, so it drags nothing.
  if (props.drag) {
    props.drag.onPointer = (x, _y, down) => {
      if (!dragging) return;
      if (!down) dragging = false;
      else setFrom(x);
    };
  }

  return (
    <box id="Root" style={s.root}>
      <text style={s.title}>Widgets</text>
      <box {...bind.press} style={s.button}>
        <text style={s.label}>{`Presses: ${count()}`}</text>
      </box>
      <box {...bind.wifi} style={s.row}>
        <box style={wifi.checked() ? s.trackOn : s.track}>
          <box style={s.thumb} />
        </box>
        <text style={s.label}>Wi-Fi</text>
      </box>
      <Check cb={all} bind={bind.all} label="Select all" />
      <Check cb={wired} bind={bind.wired} label="Wired" indented />
      <Check cb={wireless} bind={bind.wireless} label="Wireless" indented />
      <Check cb={beta} bind={bind.beta} label="Beta (disabled)" />
      <box {...bind.more} style={s.row}>
        <text style={s.mark}>{more.expanded() ? "-" : "+"}</text>
        <text style={s.label}>Details</text>
      </box>
      <Show when={!more.panel.hidden}>
        <box id={more.panel.id} style={s.panel}>
          <text style={s.note}>This panel is the disclosure's: Enter, Space or a click on its trigger hides it.</text>
        </box>
      </Show>
      <box style={s.field}>
        <box style={s.caption}>
          <text style={s.label}>Speed</text>
        </box>
        {speed.radios.map((r, i) => (
          <box {...groupBind.speed[i]!} style={s.choice}>
            <box style={r.disabled ? s.radioDisabled : r.checked ? s.radioOn : s.radio}>
              <Show when={r.checked}>
                <box style={s.dot} />
              </Show>
            </box>
            <text style={r.disabled ? s.labelDisabled : s.label}>{SPEEDS[i]}</text>
          </box>
        ))}
      </box>
      <box style={s.tabsBox}>
        <box style={s.tablist}>
          {tabs.tabs.map((t, i) => (
            <box {...groupBind.tabs[i]!} style={t.selected ? s.tabOn : s.tab}>
              <text style={s.label}>{TABS[i]!.name}</text>
            </box>
          ))}
        </box>
        {tabs.panels.map((p, i) => (
          <Show when={!p.hidden}>
            <box {...groupBind.panels[i]!} style={s.tabPanel}>
              {TABS[i]!.lines.map((line) => (
                <text style={s.note}>{line}</text>
              ))}
            </box>
          </Show>
        ))}
      </box>
      <box style={s.field}>
        <box style={s.caption}>
          <text style={s.label}>Volume</text>
        </box>
        <box id={groupBind.volume.id} focused={groupBind.volume.focused} style={s.sliderRow}>
          <box id="volume-rail" onPress={onRail} style={s.rail}>
            <box style={fillOf((volume.value() / 100) * (140 - KNOB))} />
            <box id="volume-knob" style={s.knob} />
            <box style={s.slack} />
          </box>
          <box style={s.readout}>
            <text style={s.label}>{volume.thumb.valueText}</text>
          </box>
        </box>
      </box>
      <box style={s.tools}>
        {format.items.map((item, i) => (
          <box {...groupBind.format[i]!} style={s.tool}>
            <text style={s.label}>{item.label}</text>
            <box style={on()[i] ? s.ledOn : s.led} />
          </box>
        ))}
      </box>
    </box>
  );
}
