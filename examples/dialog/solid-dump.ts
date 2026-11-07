// The Solid Dialog page's own frame at the three states examples/dialog/gen.c dumps, as the reference the generated C is
// compared with (dump-check.ts): the page through solid/dump.ts's `capture` — `ui_init`, the font, the page's own keys
// and frames, then `ui_dump_json`, the emitter every golden in solid/goldens is stored with. Same page, same Clay, same
// ThorVG measure; one frame each, taken to rest.
//
//   bun examples/dialog/solid-dump.ts <out dir>     closed.json, menu.json, dialog.json as solid-*.json
//
// The stored dialog golden (solid/goldens/dialog.json) is the menu *two frames* into its slide (`dump.ts`'s PAGES.dialog:
// `--keys Tab,Tab,Enter --settle 2`): the menu's float offset y there is the value channel's animated -12.5813, not the
// style's -20, and the frame carries the group (alpha, scale, rotate), the shadow's blur and the menu's backdrop. A
// static C frame is the page at rest, so it is not that frame; the reference here is the same page at rest, which is
// what a generated frame is.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { capture } from "../../solid/dump.ts";
import { format } from "../../solid/src/format.ts";
import type { Rest } from "../../solid/dump.ts";

const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });

// the states: no keys (both overlays closed), Tab,Tab,Enter (the menu opens on its trigger, the first item focused), and
// Tab,Enter (the dialog's Open settings, Cancel focused); a page at rest is its frame after the entry, hence 30 settles.
// `keys: []`/`settle: 0` are the page's own run without its stored keys.
const runs: readonly (readonly [string, Rest])[] = [
  ["closed", { warm: 1, keys: [], settle: 0 }],
  ["menu", { warm: 1, keys: ["Tab", "Tab", "Enter"], settle: 30 }],
  ["dialog", { warm: 1, keys: ["Tab", "Enter"], settle: 30 }],
];
for (const [name, run] of runs) {
  const dump = await capture("dialog", undefined, run);
  writeFileSync(`${out}/solid-${name}.json`, `${format(dump)}\n`);
  console.log(`${name}: ${dump.commands.length} commands`);
}
