// The Sensors page of examples/sensors/page.c as Solid JSX: the same styles.ts, the same fixed sample, the same
// strings. The Units pill flips `useG`; its pressed look is the `:active` of its style. Values are rounded to float,
// as C computes them, so the digits are the same.
import { createSignal } from "solid-js";

import * as s from "../../examples/sensors/styles.ts";

const f = Math.fround;
const ACCEL = [1.159, -0.718, 10.044].map(f);
const GYRO = [2.23, 4.82, 0.02].map(f);
const G = f(1 / f(9.80665));

const signed = (x: number, digits: number) => (x < 0 ? "-" : "+") + Math.abs(x).toFixed(digits);
const sum = (v: number[]) => v.reduce((acc, x) => f(acc + f(x * x)), 0);

export function Sensors() {
  const [useG, setUseG] = createSignal(false);
  const scale = () => (useG() ? G : 1);
  const unit = () => (useG() ? "g" : "m/s\u00b2");

  return (
    <box id="Root" style={s.root}>
      {/* the page's name in a box with the id the shell's "Title" carries: the way home on every screen, and the
          one element a target's pointer handling can find (the generated C has no handlers of its own) */}
      <box id="Title">
        <text style={s.title}>Sensors</text>
      </box>
      <text style={s.caption}>{`accel ${unit()}`}</text>
      <text style={s.value}>{ACCEL.map((x) => signed(f(x * scale()), 2)).join("  ")}</text>
      <text style={s.caption}>{"gyro \u00b0/s"}</text>
      <text style={s.value}>{GYRO.map((x) => signed(x, 1)).join("  ")}</text>
      <text style={s.magnitude}>{`|a| ${f(f(Math.sqrt(sum(ACCEL))) * scale()).toFixed(2)} ${unit()}`}</text>
      <box id="Units" style={s.units} onClick={() => setUseG((g) => !g)}>
        <text style={s.unitsLabel}>{useG() ? "switch to m/s\u00b2" : "switch to g"}</text>
      </box>
    </box>
  );
}
