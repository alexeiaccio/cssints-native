// The Sensors page of examples/sensors/page.c as Solid JSX: the same styles.ts, the same fixed sample, the same
// strings. The Units pill flips `useG`; its pressed look is the `:active` of its style. Values are rounded to float,
// as C computes them, so the digits are the same.
//
// `image` is the `IMAGE=1` variant of page.c: the 32x32 glyph of styles.ts, a leaf box under the title. A prop, not a
// signal, because the C page reads it once (getenv) and it never changes within a frame.
import { createSignal, Show } from "solid-js";

import * as s from "../../examples/sensors/styles.ts";
import { pageEntry, type Motion } from "../src/entry.ts";

const f = Math.fround;
const ACCEL = [1.159, -0.718, 10.044].map(f);
const GYRO = [2.23, 4.82, 0.02].map(f);
const G = f(1 / f(9.80665));

const signed = (x: number, digits: number) => (x < 0 ? "-" : "+") + Math.abs(x).toFixed(digits);
const sum = (v: number[]) => v.reduce((acc, x) => f(acc + f(x * x)), 0);

export function Sensors(props: { motion?: Motion; image?: boolean } = {}) {
  const [useG, setUseG] = createSignal(false);
  pageEntry(props.motion);
  const scale = () => (useG() ? G : 1);
  const unit = () => (useG() ? "g" : "m/s\u00b2");

  return (
    <box id="Root" style={s.root}>
      {/* the page's name in a box with the id the shell's "Title" carries: the way home on every screen, and the
          one element a target's pointer handling can find (the generated C has no handlers of its own) */}
      <box id="Title">
        <text style={s.title}>Sensors</text>
      </box>
      {/* page.c's IMAGE=1: the page's own image, a leaf whose box is the style's 32x32 */}
      <Show when={props.image}>
        <box id="Glyph" style={s.glyph} />
      </Show>
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
