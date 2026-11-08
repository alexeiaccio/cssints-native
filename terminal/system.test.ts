// The terminal's replies, as bytes: the query it sends, the parser that takes OSC 10, 11 and 4 and the colour-scheme
// report out of a chunk, what stays of the input (keys, mouse), and a reply cut off at the end of a chunk kept for the
// next one. Run: node terminal/system.test.ts
import assert from "node:assert/strict";

import { COLOURS, NOTIFY, QUERY, scan, UNNOTIFY } from "./system.ts";

const ESC = "\x1b";
const ST = `${ESC}\\`;
const BEL = "\x07";
let checks = 0;
const ok = (what: string) => (checks++, console.log(`ok   ${what}`));

// the query asks for the two defaults, the sixteen ANSI entries, and `CSI ? 996 n`
assert.ok(QUERY.startsWith(`${ESC}]10;?${ST}${ESC}]11;?${ST}${ESC}]4;0;?${ST}`), "OSC 10, 11 and 4 answer the query");
assert.ok(QUERY.endsWith(`${ESC}]4;15;?${ST}${ESC}[?996n`), "the sixteenth ANSI entry and the scheme report end it");
assert.equal(COLOURS.includes("\x1b]4;15;?\x1b\\"), true, "COLOURS is QUERY without the scheme report");
assert.equal(NOTIFY, "\x1b[?2031h");
assert.equal(UNNOTIFY, "\x1b[?2031l");
ok("the query and the palette-change modes");

// a chunk with both reply forms, the scheme, and keys around them
const chunk =
  `j${ESC}]11;rgb:2828/2828/2828${ST}` +
  `${ESC}]10;rgb:eb/db/b2${BEL}` +
  `${ESC}]4;1;rgb:cccc/2424/1d1d${ST}k` +
  `${ESC}]4;4;#458588${BEL}${ESC}[?997;1n${ESC}[A` +
  `${ESC}]4;12;rgba:8383/a5a5/9898/ffff${ST}`;
const r = scan(chunk);
assert.equal(r.rest, `jk${ESC}[A`, "the keys stay and the replies go");
assert.equal(r.tail, "", "nothing is left hanging");
assert.equal(r.replies.bg, "#282828", "OSC 11 is the background");
assert.equal(r.replies.fg, "#ebdbb2", "OSC 10 is the foreground, BEL-terminated");
assert.equal(r.replies.scheme, "dark", "`CSI ? 997;1 n` is dark");
assert.deepEqual(
  [...r.replies.ansi],
  [
    [1, "#cc241d"],
    [4, "#458588"],
    [12, "#83a598"],
  ],
  "the ANSI entries by index, hex or rgba",
);
ok("a chunk of replies, keys and all");

// a reply cut by the end of a chunk is kept for the next; a lone ESC (the Escape key) is not
const cut = scan(`q${ESC}]11;rgb:ef`);
assert.deepEqual([cut.rest, cut.tail], ["q", `${ESC}]11;rgb:ef`], "a cut reply is the tail");
assert.equal(scan(`${cut.tail}f/f1/f5${ST}`).replies.bg, "#eff1f5", "the tail and the next chunk are one reply");
assert.deepEqual(scan(`x${ESC}`).rest, `x${ESC}`, "a lone ESC is a key, not a reply");
const schemeCut = scan(`${ESC}[?99`);
assert.deepEqual([schemeCut.rest, schemeCut.tail], ["", `${ESC}[?99`], "a cut scheme report is the tail");
assert.equal(scan(`${schemeCut.tail}7;2n`).replies.scheme, "light", "`CSI ? 997;2 n` is light");
ok("a reply cut in two, and a lone ESC");

// a 3-digit hex and a 12-digit one are the same colour path; an index past 15 is not a slot
const short = scan(`${ESC}]4;2;#abc${BEL}`).replies.ansi.get(2);
assert.equal(short, "#aabbcc", "#abc is #aabbcc");
assert.equal(scan(`${ESC}]4;20;#ffffff${BEL}`).replies.ansi.has(20), false, "an index past 15 is not an ANSI slot");
ok("hex widths and the slot cut");

console.log(`\nterminal/system.test.ts: ${checks} groups, the wire's cases among them`);
