// The Widgets page: the headless button, switch, checkbox (one of them mixed, one disabled) and disclosure, drawn from
// widgets.styles.ts. Each widget's style is picked from its part's fields (`checked`, `disabled`, `hidden`); the
// pressed look and the focus ring are the styles' `:active` and `:focus`. Every part is registered in the focus
// manager in document order, so Tab walks them top to bottom.
import { createSignal, Show } from "solid-js";

import { createButton, createCheckbox, createDisclosure, createSwitch, type Checkbox } from "../../headless/src/index.ts";
import type { Bind, Input } from "../src/input.ts";
import * as s from "./widgets.styles.ts";

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

export function Widgets(props: { input: Input }) {
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
    </box>
  );
}
