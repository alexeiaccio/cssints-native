// The inline-demo page with its styles in a separate module: the reference InlineDemo.tsx must match pixel for pixel.
import { createSignal } from "solid-js";

import * as s from "./inline-demo.styles.ts";

export function InlineDemoSplit(props: { focus?: boolean }) {
  const [count, setCount] = createSignal(0);
  return (
    <box id="Root" style={s.root}>
      <text style={s.title}>Inline styles</text>
      <box style={s.panel}>
        <text style={s.caption}>the styles live next to the markup</text>
        <text style={s.value}>{`Presses: ${count()}`}</text>
        <box style={s.row}>
          <box style={s.chip}>
            <text style={s.caption}>composed</text>
          </box>
          <box style={s.chipOn}>
            <text style={s.caption}>token</text>
          </box>
        </box>
      </box>
      <box id="press" style={s.button} focused={props.focus} onClick={() => setCount((n) => n + 1)}>
        <text style={s.label}>Press</text>
      </box>
    </box>
  );
}
