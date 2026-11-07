// The console sink's two readings, both a check's: the ANSI dump parsed back to cells, and the sink's JSON parsed back
// to cells. The sink itself is terminal/cells.c; these are how a check holds it (terminal/console.mjs, and the browser's
// console page in browser/console-check.mjs, which compares its frames with the terminal's).
/** The ANSI dump as rows of {ch, fg, bg}: a cursor move a row, SGR runs, one glyph a cell. */
export function ansiRows(text) {
  const rows = text
    .split(/\x1b\[\d+;1H/)
    .slice(1)
    .map((row) => {
      const cells = [];
      let fg, bg;
      for (let i = 0; i < row.length; ) {
        if (row[i] === "\x1b") {
          const sgr = /^\x1b\[(38|48);2;(\d+);(\d+);(\d+)m/.exec(row.slice(i));
          if (sgr) {
            const rgb = [Number(sgr[2]), Number(sgr[3]), Number(sgr[4])];
            if (sgr[1] === "38") fg = rgb;
            else bg = rgb;
            i += sgr[0].length;
            continue;
          }
          const reset = /^\x1b\[0m/.exec(row.slice(i));
          if (reset) {
            i += reset[0].length;
            continue;
          }
          throw new Error(`ansi: unexpected escape at ${i}`);
        }
        const ch = String.fromCodePoint(row.codePointAt(i));
        cells.push({ ch, fg, bg });
        i += ch.length;
      }
      return cells;
    });
  return rows;
}

/** The sink's JSON as rows of {ch, fg, bg}: %c consumes the next style, %% is a literal %, \n a row. */
export function consoleCells(text) {
  const args = JSON.parse(text);
  if (!Array.isArray(args) || typeof args[0] !== "string") throw new Error("console: not an argument array");
  const format = args[0];
  const styles = args.slice(1);
  const rows = [[]];
  let run = -1;
  let style;
  for (let i = 0; i < format.length; ) {
    if (format.startsWith("%%", i)) {
      rows.at(-1).push({ ch: "%", ...style });
      i += 2;
      continue;
    }
    if (format.startsWith("%c", i)) {
      run++;
      const s = styles[run];
      const m = /^color:#([0-9a-f]{6});background:#([0-9a-f]{6})$/.exec(s ?? "");
      if (!m) throw new Error(`console: style ${run} is not a colour pair: ${JSON.stringify(s)}`);
      const rgb = (hex) => [0, 2, 4].map((k) => parseInt(hex.slice(k, k + 2), 16));
      style = { fg: rgb(m[1]), bg: rgb(m[2]) };
      i += 2;
      continue;
    }
    if (format[i] === "\n") {
      rows.push([]);
      i++;
      continue;
    }
    const ch = String.fromCodePoint(format.codePointAt(i));
    if (!style) throw new Error(`console: text before the first %c: ${JSON.stringify(ch)}`);
    rows.at(-1).push({ ch, ...style });
    i += ch.length;
  }
  return { rows, runs: styles.length };
}

/** The cells two rows of the same frame should be: the glyph and both colours. */
export const sameCell = (a, b) =>
  a.ch === b.ch && JSON.stringify(a.fg) === JSON.stringify(b.fg) && JSON.stringify(a.bg) === JSON.stringify(b.bg);
/** The first cell two rows differ in, or -1. */
export const rowDiff = (a, b) => {
  let at = -1;
  for (let i = 0; i < Math.max(a.length, b.length) && at < 0; i++) if (!a[i] || !b[i] || !sameCell(a[i], b[i])) at = i;
  return at;
};
