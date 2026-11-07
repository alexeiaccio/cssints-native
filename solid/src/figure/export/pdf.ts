// The deck as a PDF: `./deck.ts`'s HTML, printed by Chromium — the same Playwright dependency and the same
// `chromium.launch()` the browser checks use. The page is A4 landscape with a 12 mm margin, from the deck's own
// `@page` rule (`preferCSSPageSize`), so the sheet and the margins are the deck's and not the printer's; every slide
// is `break-after: page`, so the PDF is one page a slide and `page.pdf()`'s page count is the specs' count.
//
// **The text is text.** Chromium embeds a subset font per face and writes glyph ids, with a `ToUnicode` CMap per font,
// so a PDF's visible text is not a string you can grep. `pdfText()` below is the small reader that puts it back
// together: the objects, one page's content stream, the `/Fn … Tf` that picks a font, the `<hex> Tj` runs, and each
// font's `ToUnicode` `bfchar`/`bfrange` — enough to read a title back as characters. That is how the test knows a slide
// is selectable text and not an image: the title comes out of the page's own glyph stream.
//
// No new dependency: the streams are zlib's (`node:zlib` inflates them) and the syntax is the few operators above.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";

import { PAGE } from "./deck.ts";

export interface PdfOptions {
  /** The file to write. */
  readonly path: string;
}

/** One PDF object: its number, its dictionary (latin1) and its stream bytes, already inflated. */
interface PdfObject {
  readonly num: number;
  readonly dict: string;
  readonly stream?: Buffer;
}

const latin1 = (bytes: Buffer): string => bytes.toString("latin1");

/** Every `N 0 obj` of the file, with its dictionary and its stream (inflated when it is a Flate stream). */
function objectsOf(bytes: Buffer): Map<number, PdfObject> {
  const text = latin1(bytes);
  const out = new Map<number, PdfObject>();
  const start = /(\d{1,7}) 0 obj/g;
  let match: RegExpExecArray | null;
  while ((match = start.exec(text))) {
    const num = Number(match[1]);
    const from = match.index + match[0].length;
    const streamAt = text.indexOf("stream", from);
    const endobj = text.indexOf("endobj", from);
    const hasStream = streamAt >= 0 && (endobj < 0 || streamAt < endobj);
    const dict = text.slice(from, hasStream ? streamAt : endobj < 0 ? undefined : endobj);
    if (!hasStream) {
      out.set(num, { num, dict });
      continue;
    }
    const length = Number(/\/Length (\d+)/.exec(dict)?.[1] ?? -1);
    let at = streamAt + "stream".length;
    if (text[at] === "\r") at++;
    if (text[at] === "\n") at++;
    // a `/Length` that is an indirect reference or a byte out of place: the `endstream` keyword is the truth
    const to = length >= 0 && text.startsWith("endstream", at + length) ? at + length : text.indexOf("endstream", at);
    const raw = bytes.subarray(at, to);
    out.set(num, {
      num,
      dict,
      stream: /\/Filter\s*\/FlateDecode/.test(dict) ? inflateSync(raw) : raw,
    });
    start.lastIndex = to;
  }
  return out;
}

/** The object a `/Name N 0 R` entry of a dictionary points at. */
const refOf = (dict: string, name: string): number | undefined =>
  Number(new RegExp(`/${name}\\s+(\\d+) 0 R`).exec(dict)?.[1] ?? NaN) || undefined;

/** The page objects, in the file's own order (Chromium writes them as the deck's slides). */
const pagesOf = (objects: Map<number, PdfObject>): PdfObject[] =>
  [...objects.values()].filter((object) => /\/Type\s*\/Page[^s]/.test(object.dict));

/** A CMap's code → text map: `bfchar` pairs and `bfrange` runs, the two forms Chromium writes. */
function unicodeOf(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  /** UTF-16BE hex (`00660069` is "fi") as a string. */
  const utf16 = (hex: string): string => {
    const units: number[] = [];
    for (let i = 0; i + 4 <= hex.length; i += 4) units.push(parseInt(hex.slice(i, i + 4), 16));
    return String.fromCharCode(...units);
  };
  for (const block of cmap.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    for (const pair of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g))
      map.set(parseInt(pair[1]!, 16), utf16(pair[2]!));
  }
  for (const block of cmap.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    for (const run of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g)) {
      const from = parseInt(run[1]!, 16);
      const to = parseInt(run[2]!, 16);
      const target = run[3]!;
      if (target.startsWith("[")) {
        const list = [...target.matchAll(/<([0-9a-fA-F]+)>/g)].map((one) => utf16(one[1]!));
        for (let code = from; code <= to && code - from < list.length; code++) map.set(code, list[code - from]!);
      } else {
        // a run counts up from its first character: the last code unit moves, the prefix stays
        const first = utf16(target.slice(1, -1));
        for (let code = from; code <= to; code++) {
          const last = String.fromCharCode(first.charCodeAt(first.length - 1) + (code - from));
          map.set(code, first.slice(0, -1) + last);
        }
      }
    }
  }
  return map;
}

/** A page's fonts, by the name its content stream uses (`/F4`), each font's own code → text map. */
function fontsOf(page: PdfObject, objects: Map<number, PdfObject>): Map<string, Map<number, string>> {
  const out = new Map<string, Map<number, string>>();
  const fonts = /\/Font\s*<<([\s\S]*?)>>/.exec(page.dict)?.[1] ?? "";
  for (const entry of fonts.matchAll(/\/(\w+)\s+(\d+) 0 R/g)) {
    const font = objects.get(Number(entry[2]));
    const toUnicode = font ? refOf(font.dict, "ToUnicode") : undefined;
    const cmap = toUnicode === undefined ? undefined : objects.get(toUnicode)?.stream;
    if (cmap) out.set(entry[1]!, unicodeOf(latin1(cmap)));
  }
  return out;
}

/** One page's text, put back together from its `<hex> Tj` runs through the font each `/Fn … Tf` picks. */
function textOfPage(page: PdfObject, objects: Map<number, PdfObject>): string {
  const fonts = fontsOf(page, objects);
  const refs = [...(page.dict.match(/\/Contents\s*(\[[^\]]*\]|\d+ 0 R)/)?.[1] ?? "").matchAll(/(\d+) 0 R/g)];
  let out = "";
  for (const ref of refs) {
    const raw = objects.get(Number(ref[1]))?.stream;
    if (!raw) continue;
    const content = latin1(raw).replace(/\bBI[\s\S]*?\bEI\b/g, " ");
    let map: Map<number, string> | undefined;
    for (const token of content.matchAll(
      /\/(\w+)\s+[-\d.]+\s+Tf|<([0-9a-fA-F\s]+)>|\(((?:\\.|[^\\)])*)\)/g,
    )) {
      if (token[1] !== undefined) map = fonts.get(token[1]);
      else if (token[2] !== undefined) {
        const hex = token[2].replace(/\s+/g, "");
        for (let i = 0; i + 4 <= hex.length; i += 4) out += map?.get(parseInt(hex.slice(i, i + 4), 16)) ?? "";
      } else out += (token[3] ?? "").replace(/\\(.)/g, "$1");
    }
  }
  return out;
}

/** Every page's text, in the PDF's order: what the printed deck says, as characters. */
export function pdfText(bytes: Uint8Array): string[] {
  const objects = objectsOf(Buffer.from(bytes));
  return pagesOf(objects).map((page) => textOfPage(page, objects));
}

/** The PDF's page count (its `/Type /Page` objects). */
export const pdfPageCount = (bytes: Uint8Array): number => pagesOf(objectsOf(Buffer.from(bytes))).length;

/** The first page's `MediaBox` in PDF points ([0 0 842.88 595.92] is A4 landscape). */
export function pdfMediaBox(bytes: Uint8Array): { width: number; height: number } {
  const box = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/.exec(
    latin1(Buffer.from(bytes)),
  );
  if (!box) return { width: 0, height: 0 };
  return { width: Number(box[3]) - Number(box[1]), height: Number(box[4]) - Number(box[2]) };
}

/**
 * The deck as a PDF: A4 landscape with a 12 mm margin (the deck's `@page` rule, `preferCSSPageSize`), one page a slide,
 * backgrounds printed. The two flags repeat the sheet so the file is the same shape even if the deck's rule is lost.
 */
export async function pdf(html: string, options: PdfOptions): Promise<void> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const bytes = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      format: PAGE.paper,
      landscape: true,
      margin: { top: `${PAGE.margin}mm`, right: `${PAGE.margin}mm`, bottom: `${PAGE.margin}mm`, left: `${PAGE.margin}mm` },
    });
    writeFileSync(resolve(options.path), bytes);
  } finally {
    await browser.close();
  }
}
