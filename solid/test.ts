// What the stored frames cannot show, on the Solid page: the `:active` look while the Units pill is pressed, the
// click that flips the signal on release, and no click when the press was elsewhere. Frames as host.c's --click.
// The frames themselves are compared by `main.ts --expect` (see test.sh).
import "./plugin.ts";

const { ui } = await import("./src/ffi.ts");
const { createFrame } = await import("./src/frame.ts");
const { El, render, Txt } = await import("./src/renderer.ts");
const { Sensors } = await import("./app/Sensors.tsx");
const s = await import("../examples/sensors/styles.ts");

ui.init(360, 360);
ui.font(new URL("../vendor/fonts/Roboto-Regular.ttf", import.meta.url).pathname);
const root = new El("root");
render(Sensors, root);
const frame = createFrame(root);

const pill = () => ui.pixel(100, 247).join(",");
const label = () => ((root.children[0] as El).children.at(-1) as El).children[0] as El;
const text = () => (label().children[0] as Txt).text;
let failed = 0;
const check = (what: string, got: unknown, want: unknown) => {
  if (got !== want) failed++, console.error(`FAIL ${what}: ${got}, wanted ${want}`);
};

const step = (x: number, y: number, down: boolean) => frame(x, y, down, 1 / 60);
step(10, 10, false);
check("rest, pointer away", pill(), "36,40,52,255");
step(180, 250, false);
check("hover look (:hover)", pill(), "48,53,68,255");
step(180, 250, true);
check("pressed look (:active)", pill(), "64,70,90,255");
check("press alone does not click", text(), "switch to g");
step(180, 250, false);
check("released, still hovered", pill(), "48,53,68,255");
check("click flips the signal", text(), "switch to m/s\u00b2");

// pressed on the pill, released away from it: no click
step(180, 250, true);
step(10, 10, false);
check("press here, release elsewhere", text(), "switch to m/s\u00b2");
// pressed away, released on the pill: no click
step(10, 10, true);
step(180, 250, false);
check("press elsewhere, release here", text(), "switch to m/s\u00b2");

// contrast: the ink on every fill the pill can have, in both themes (WCAG 2: at least 4.5:1)
{
  type Rgb = { r: number; g: number; b: number };
  type Shape = { backgroundColor?: Rgb; text?: { textColor?: Rgb }; [k: string]: unknown };
  const lum = ({ r, g, b }: Rgb) => {
    const ch = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  };
  const themed = (shape: Shape, theme?: string): Shape =>
    theme ? { ...shape, ...((shape.themes as Record<string, Shape>)[theme] ?? {}) } : shape;
  for (const theme of [undefined, "light"]) {
    const ink = themed(s.unitsLabel as Shape, theme).text!.textColor!;
    const base = themed(s.units as Shape, theme);
    for (const state of ["", ":hover", ":active"]) {
      const fill = ((state ? (base[state] as Shape) : base).backgroundColor ?? base.backgroundColor)!;
      const [x, y] = [lum(ink), lum(fill)].sort((m, n) => n - m);
      const r = (x! + 0.05) / (y! + 0.05);
      if (r < 4.5) failed++, console.error(`FAIL contrast ${theme ?? "dark"}${state}: ${r.toFixed(2)}:1`);
    }
  }
}

if (failed) process.exit(1);
console.log("solid/test.ts: the pressed look and the click are right");
process.exit(0);
