// A C host's frame against a golden: the command stream of `desktop/host.c --dump` (or any other host that writes
// desktop/clay_dump.c's JSON) compared field by field, and byte for byte, with a golden of the same page.
//
//   node dump-check.ts solid/goldens/sensors.json /tmp/sensors.json
//   node dump-check.ts solid/goldens/sensors.json /tmp/sensors.json --name sensors
//   node dump-check.ts /tmp/dialog.json /tmp/dialog-c.json --commands
//
// `--commands` compares the command array only: a C page keeps no renderer tables (a shadow, a backdrop, a group are no
// Clay field, so header() drops them and the C host's tables are empty), while its commands are the same bytes as the
// Solid host's. Without it the whole frame is compared, the effects and the text weight included.
//
// Three things a C host does not know, and the golden does, are settled here and nowhere else:
//   — the page's id strings: the Solid host interns them from its JSX tree, a C page only has Clay's hashes, so a
//     command's `element` is null and is resolved by id from the golden (the same page, the same ids);
//   — the frame's hash, which `ui_dump_json` writes (a golden drops it: with an image it is an address) and a C host
//     leaves at zero;
//   — the a11y snapshot, which only the Solid host has (a C page declares no roles).
// What is left is compared as the goldens' formatter writes it (`solid/src/format.ts`, the one `solid/dump.ts` stores
// them with), so two processes compare the same bytes, and a miss names the command and the field:
//
//   FAIL sensors: command 2 (text "accel m/s²") colour 150/155/170/255 -> 160/165/180/255
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { format } from "./solid/src/format.ts";

const argv = process.argv.slice(2);
const nameAt = argv.indexOf("--name");
const name = nameAt < 0 ? undefined : argv[nameAt + 1];
const skip = nameAt < 0 ? -1 : nameAt + 1;
const commandsOnly = argv.includes("--commands");
const paths = argv.filter((a, i) => !a.startsWith("--") && i !== skip);
const [goldenPath, dumpPath] = paths as [string | undefined, string | undefined];
if (!goldenPath || !dumpPath) {
  console.error("usage: node dump-check.ts <golden.json> <dump.json> [--name page]");
  process.exit(2);
}
const page = name ?? basename(goldenPath).replace(/\.json$/, "");

type Json = Record<string, unknown>;
const want = JSON.parse(readFileSync(goldenPath, "utf8")) as Json;
const got = JSON.parse(readFileSync(dumpPath, "utf8")) as Json;
delete want.a11y;
delete want.hash;
delete got.hash;

/** The golden's names, by Clay id: a host without the page's id strings leaves `element` null. */
const named = new Map<number, string>();
const lists = (frame: Json) =>
  [
    frame.commands,
    ...["shadows", "backdrops", "gradients"].map((table) => (frame.effects as Json)?.[table]),
  ].map((list) => (Array.isArray(list) ? (list as Json[]) : []));
for (const list of lists(want))
  for (const entry of list)
    if (typeof entry.element === "string" && typeof entry.id === "number") named.set(entry.id, entry.element);
// the same ids on the same page: a command (or a shadow, backdrop or gradient) whose host has no strings is named from
// the golden, which is how the rest of the frame compares byte for byte
for (const list of lists(got))
  for (const entry of list)
    if (entry.element == null && typeof entry.id === "number" && named.has(entry.id))
      entry.element = named.get(entry.id);

const primitive = (v: unknown) => v === null || typeof v !== "object";
const flat = (v: unknown[]) => v.every(primitive);
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
/** A value as a line prints it: a box or a colour as its numbers, a string quoted, nothing as "(absent)". */
const show = (v: unknown) =>
  v === undefined ? "(absent)" : Array.isArray(v) ? v.map((x) => String(x)).join("/") : JSON.stringify(v);

/** The field names a page reads better than the JSON spells them. */
const DISPLAY: Record<string, string> = { color: "colour" };

/** "commands[3].color" is `command 3 (text "switch to g") colour`, the command's own type and text in the message. */
function where(path: string, golden: Json): string {
  const m = /^commands\[(\d+)\](.*)$/.exec(path);
  if (m === null) return path;
  const commands = golden.commands as Json[];
  const command = commands[Number(m[1])];
  const text = typeof command?.text === "string" ? ` ${JSON.stringify(command.text)}` : "";
  const rest = m[2]!.replace(/^\.([a-z]+)/, (_, key: string) => ` ${DISPLAY[key] ?? key}`);
  return `command ${m[1]} (${command?.type}${text})${rest}`;
}

/** The extra a value needs when it is one that moved: an id that is another command's is out of order. */
function hint(path: string, got: unknown, golden: Json): string {
  const m = /^commands\[(\d+)\]\.id$/.exec(path);
  if (m === null) return "";
  const at = (golden.commands as Json[]).findIndex((command) => command.id === got);
  return at >= 0 && at !== Number(m[1]) ? ` (that is command ${at} in the golden: the order moved)` : "";
}

/** Every difference between a golden and the frame (at most a handful, the first one is the message), path by path. */
function compare(want: unknown, got: unknown, path: string, out: string[], golden: Json): void {
  if (out.length >= 6) return;
  const place = where(path, golden);
  if (Array.isArray(want) && Array.isArray(got)) {
    if (flat(want) && flat(got)) {
      // a colour, a box, a set of widths: one value with its numbers joined, not four diffs
      if (want.length !== got.length || want.some((v, i) => v !== got[i]))
        out.push(`${place} ${show(want)} -> ${show(got)}`);
      return;
    }
    if (want.length !== got.length) out.push(`${place}: ${want.length} -> ${got.length}`);
    for (let i = 0; i < Math.min(want.length, got.length); i++) compare(want[i], got[i], `${path}[${i}]`, out, golden);
    return;
  }
  if (isObject(want) && isObject(got)) {
    // the keys the golden and the frame disagree on: a field that appeared or vanished is a difference too
    const keys = [...new Set([...Object.keys(want), ...Object.keys(got)])].sort();
    for (const key of keys) compare(want[key], got[key], path === "" ? key : `${path}.${key}`, out, golden);
    return;
  }
  if (want !== got) out.push(`${place} ${show(want)} -> ${show(got)}${hint(path, got, golden)}`);
}

// the frame as compared: the whole of it, or the commands alone (`--commands`: the effect tables are the host's, and
// a C page keeps none of them)
const view = (frame: Json): Json => (commandsOnly ? { commands: frame.commands } : frame);
const a = format(view(want));
const b = format(view(got));
if (a === b) {
  console.log(`${page}: ${(got.commands as unknown[]).length} commands, identical`);
} else {
  const diffs: string[] = [];
  const golden = view(want);
  compare(golden, view(got), "", diffs, golden);
  for (const line of diffs) console.error(`FAIL ${page}: ${line}`);
  console.error(`  re-store it after a deliberate change, and read the diff first: ${goldenPath}`);
  process.exit(1);
}
