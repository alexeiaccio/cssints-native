// The Text sheet in the browser: app/Sheet.tsx **unmodified** (440x564), twelve rows of the app's strings at eight
// sizes, static — the frame that is the same on every run, and the one the text oracle's metric crops. It takes no
// input and no hooks: the shell's own loop, and the page is one that never draws after its first frame.
//
// It is the shell's page rather than its own loop for the same reason the other seven are: one canvas, one drawer, one
// `window.__page` the check drives — a static page is not a special case, and its frame is a command array like any
// other.
import { Sheet, size } from "../../solid/app/Sheet.tsx";
import { mountPage } from "./shell.ts";

await mountPage({ width: size.width, height: size.height, tree: () => () => Sheet() });
