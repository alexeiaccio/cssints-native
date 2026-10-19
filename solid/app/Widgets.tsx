// The Widgets page: the headless button, switch, checkbox (one of them mixed, one disabled) and disclosure, then a radio
// group, tabs, a slider and a toolbar, drawn from widgets.styles.ts. Each widget's style is picked from its part's fields
// (`checked`, `selected`, `disabled`, `hidden`); the pressed look and the focus ring are the styles' `:active` and
// `:focus`. Every part is registered in the focus manager in document order, so Tab walks them top to bottom; the four
// groups are one stop each (radio, tabs and toolbar are groups of the manager, the slider is one entry).
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
import * as s from "./widgets.styles.ts";

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
export function Widgets(props: { input: Input; disabledSpeeds?: number[] }) {
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

  // a press on the rail sets the value from where the press was: the rail's bounds from the last layout, the thumb's
  // travel being the rail less the knob, so a press on the knob's middle gives the value the knob shows
  const onRail = (x: number) => {
    const [left, , width] = ui.bounds(Buffer.from("volume-rail")) ?? [0, 0, 0];
    if (width! > KNOB) volume.pointer((x - left! - KNOB / 2) / (width! - KNOB));
  };

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
        <box id="volume-rail" onPress={onRail} style={s.rail}>
          <box style={fillOf((volume.value() / 100) * (140 - KNOB))} />
          <box id={groupBind.volume.id} focused={groupBind.volume.focused} style={s.knob} />
          <box style={s.slack} />
        </box>
        <box style={s.readout}>
          <text style={s.label}>{volume.thumb.valueText}</text>
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
