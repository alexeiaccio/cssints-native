// The terminal's own replies: the query a host asks for the palette's colours, and the parser that takes them out of a
// chunk of input (OSC 10, 11 and 4, and the colour-scheme report `CSI ? 997 n`). The solver that turns a `Report` into the
// page's tokens is `./theme.ts`'s; this file is the wire.
//
// It came from `@cssints/tui`'s `system.ts` (MIT, the same author), which is deprecated and will not be here for long:
// a terminal target that has to depend on the package it replaces is a circle. The parts kept are the ones the wire needs
// — the 16 slots, the query, the parser and the report — and the theme solver's culori maths stayed behind.
//
// The parser takes text of one char a byte (`latin1`): a reply is ASCII, and a chunk that ends mid-reply keeps its tail for
// the next one.

/** The 16 ANSI colours, by their index. */
export const SLOTS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;
export type Slot = (typeof SLOTS)[number];
/** Where a role takes its hue: an ANSI colour, or the terminal's default foreground or background. */
export type Hue = Slot | "fg" | "bg";
export type Appearance = "dark" | "light";

/** What a terminal reported: `#rrggbb` colours (`undefined` or `null`: no answer) and its colour scheme. */
export interface Report {
  fg?: string | null;
  bg?: string | null;
  ansi?: readonly (string | null | undefined)[];
  scheme?: Appearance | null;
}

/** OSC 10 and 11 (the default colours) and OSC 4 for the 16 ANSI colours. */
export const COLOURS = [
  "\x1b]10;?\x1b\\",
  "\x1b]11;?\x1b\\",
  ...SLOTS.map((_, i) => `\x1b]4;${i};?\x1b\\`),
].join("");
/** The colours and the colour-scheme report (`CSI ? 996 n`). */
export const QUERY = `${COLOURS}\x1b[?996n`;
/** Mode 2031 on: the terminal sends `CSI ? 997 ; 1|2 n` when its palette changes. */
export const NOTIFY = "\x1b[?2031h";
/** Mode 2031 off. */
export const UNNOTIFY = "\x1b[?2031l";

/** What one chunk of input held of the terminal's replies. */
export interface Replies {
  fg?: string;
  bg?: string;
  /** The ANSI colours it reported, by index. */
  ansi: Map<number, string>;
  /** The colour scheme of a `CSI ? 997 ; 1|2 n` (a reply to the query, or a notification of a change). */
  scheme?: Appearance;
}

const REPLY =
  // oxlint-disable-next-line no-control-regex
  /\x1b\](10|11|4;(\d+));(?:rgba?:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})(?:\/[0-9a-f]{1,4})?|#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{12}))(?:\x07|\x1b\\)|\x1b\[\?997;([12])n/gi;
// a reply cut off at the end of a chunk: kept for the next one
// oxlint-disable-next-line no-control-regex
const CUT = /\x1b(?:\][^\x07\x1b]*(?:\x1b)?|\[\?(?:9(?:9(?:7(?:;\d?)?)?)?)?)$/;

const channel = (h: string) => Math.round((Number.parseInt(h, 16) / (16 ** h.length - 1)) * 255);
const hexOf = (r: string, g: string, b: string) =>
  `#${[r, g, b].map((h) => channel(h).toString(16).padStart(2, "0")).join("")}`;

/**
 * Takes the terminal's replies (OSC 10, 11 and 4, `CSI ? 997 n`) out of a chunk of input, as text of one char per byte.
 *
 * @param text the chunk, after what `tail` of the last one kept
 * @returns the replies, the rest of the input (keys, mouse), and the tail of a reply cut off at the end
 */
export const scan = (text: string): { replies: Replies; rest: string; tail: string } => {
  const replies: Replies = { ansi: new Map() };
  const cut = CUT.exec(text);
  const tail = cut ? cut[0] : "";
  const body = cut ? text.slice(0, cut.index) : text;
  const rest = body.replace(REPLY, (...m: (string | undefined)[]) => {
    const [, what, index, r = "", g = "", b = "", hash, scheme] = m;
    if (scheme) {
      replies.scheme = scheme === "1" ? "dark" : "light";
      return "";
    }
    let colour: string;
    if (hash) {
      const n = hash.length / 3;
      colour = hexOf(hash.slice(0, n), hash.slice(n, 2 * n), hash.slice(2 * n));
    } else colour = hexOf(r, g, b);
    if (what === "10") replies.fg = colour;
    else if (what === "11") replies.bg = colour;
    else if (Number(index) < 16) replies.ansi.set(Number(index), colour);
    return "";
  });
  return { replies, rest, tail };
};
