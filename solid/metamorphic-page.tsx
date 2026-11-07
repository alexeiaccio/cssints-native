// The trees the metamorphic relations compare: the Sensors page plain, inside a fixed-size box, inside a padded frame,
// and a long text in two widths. Kept apart from the driver because the driver must import the plugin before a .tsx page.
import * as css from "cssints/clay" with { type: "cssints" };
import { Sensors } from "./app/Sensors.tsx";

export const PAGE = 360;
const fixed = css.cn(css.width(PAGE), css.height(PAGE));
const font = css.fonts("Roboto");
const text = css.cn(font.Roboto, css.fontSize(14), css.whiteSpace("normal"));
const body =
  "A long line of text that must wrap in a narrow box and take fewer lines in a wide one, which is the property.";

export const plain = Sensors;

export const wrapped = () => (
  <box style={fixed}>
    <Sensors />
  </box>
);

export const shifted = () => (
  <box style={css.cn(css.p(7, 0, 0, 13), css.width(PAGE + 13), css.height(PAGE + 7))}>
    <box style={fixed}>
      <Sensors />
    </box>
  </box>
);

const page = (width: string) =>
  () => (
    <box style={css.cn(css.width(PAGE), css.height(PAGE), css.flexDirection("column"))}>
      <box id="p" style={width}>
        <text style={text}>{body}</text>
      </box>
    </box>
  );

export const narrow = page(css.width(160));
export const wide = page(css.width(300));
