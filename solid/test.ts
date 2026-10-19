// What the stored frames cannot show, on the Solid page: the `:active` look while the Units pill is pressed, the
// click that flips the signal on release, and no click when the press was elsewhere. Frames as host.c's --click.
// The frames themselves are compared by `main.ts --expect` (see test.sh).
import "./plugin.ts";

const { ui } = await import("./src/ffi.ts");
const { createFrame } = await import("./src/frame.ts");
const { El, render, Txt } = await import("./src/renderer.ts");
const { Sensors } = await import("./app/Sensors.tsx");

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
step(180, 250, false);
check("rest", pill(), "36,40,52,255");
step(180, 250, true);
check("pressed look (:active)", pill(), "255,200,120,255");
check("press alone does not click", text(), "switch to g");
step(180, 250, false);
check("released", pill(), "36,40,52,255");
check("click flips the signal", text(), "switch to m/s\u00b2");

// pressed on the pill, released away from it: no click
step(180, 250, true);
step(10, 10, false);
check("press here, release elsewhere", text(), "switch to m/s\u00b2");
// pressed away, released on the pill: no click
step(10, 10, true);
step(180, 250, false);
check("press elsewhere, release here", text(), "switch to m/s\u00b2");

if (failed) process.exit(1);
console.log("solid/test.ts: the pressed look and the click are right");
process.exit(0);
