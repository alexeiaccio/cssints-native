// The card's own checks: the encoder, the document, and what a browser makes of it. The card is the one renderer here
// that a site outside this repo uses, so the checks are about the things a site depends on:
//
//   (a) `base64` is the runtime's own, for every length mod 3 (a card's picture and font ride on it);
//   (b) `cardHtml` is self-contained: the picture and the font as data URIs of the right type, no script, no external
//       stylesheet, and text escaped rather than parsed;
//   (c) `renderCards` writes 1200×630 PNGs, one browser for all of them, and two runs are the same bytes;
//   (d) a real title — 66 Cyrillic characters, the longest in an artist's index — **wraps** in the browser's own metrics
//       and does not overflow the card: that is why this is HTML and not SVG.
//
//   bun solid/card.test.ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";

import { CARD, cardHtml, type CardInput } from "./src/card/card.ts";
import { renderCards } from "./src/card/render.ts";
import { base64 } from "./src/card/base64.ts";

const work = mkdtempSync(join(tmpdir(), "cssints-card-"));
const FONT = readFileSync(new URL("../vendor/fonts/Roboto-Regular.ttf", import.meta.url));
let checks = 0;
let failed = 0;
const ok = (what: string, extra = "") => (checks++, console.log(`ok   ${what}${extra ? ` — ${extra}` : ""}`));
const bad = (what: string, why: string) => (checks++, failed++, console.error(`FAIL ${what}: ${why}`));

/** A 2×2 PNG, as bytes: the smallest picture a card can carry. */
const PIXEL = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8Dwn4GBgYGJAQ0AAB72ARl4q9GSAAAAAElFTkSuQmCC",
    "base64",
  ),
);

const pngSize = (bytes: Uint8Array): [number, number] => {
  const head = Buffer.from(bytes.subarray(0, 33));
  return [head.readUInt32BE(16), head.readUInt32BE(20)];
};

// ---- (a): the encoder -------------------------------------------------------------------------------------------------

{
  let wrong = "";
  for (let length = 0; length <= 7; length++) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) & 255);
    const ours = base64(bytes);
    const theirs = Buffer.from(bytes).toString("base64");
    if (ours !== theirs && !wrong) wrong = `${length} bytes: ${ours} against ${theirs}`;
  }
  if (!wrong) ok("base64: the runtime's own", "7 lengths, 0 to 7 bytes, padding included");
  else bad("base64: the runtime's own", wrong);
}

// ---- (b): the document ------------------------------------------------------------------------------------------------

{
  const html = cardHtml({
    title: "Собор <Александра> & Невского",
    subtitle: 'Плакат, "бумага/офорт"',
    badge: "AK",
    media: PIXEL,
    mediaBackground: "#A05339",
    font: { family: "Card Test", bytes: FONT, weight: 800 },
  });
  const problems: string[] = [];
  if (/<script\b/i.test(html)) problems.push("a script");
  if (/<link\b/i.test(html)) problems.push("an external stylesheet");
  if (!html.includes("data:image/png;base64,")) problems.push("no picture data URI");
  if (!html.includes("data:font/ttf;base64,")) problems.push("no font data URI");
  if (!html.includes("@font-face")) problems.push("no @font-face");
  if (!html.includes("Собор &lt;Александра&gt; &amp; Невского")) problems.push("the title is not escaped");
  if (html.includes("<Александра>")) problems.push("the title's angle brackets are markup");
  if (!html.includes("width: 1200px; height: 630px")) problems.push("not 1200×630");
  if (!html.includes("#A05339")) problems.push("the picture's own background is gone");
  if (problems.length) bad("cardHtml: self-contained", problems.join(", "));
  else ok("cardHtml: self-contained", `${html.length} B, the picture and the font inline, text escaped`);
}

// ---- (c): two cards, one browser, the same bytes -----------------------------------------------------------------------

const cards: CardInput[] = [
  {
    title: "Осенний этюд с ведьмой, разгоняющей тучи",
    subtitle: "Живопись, Картон/Масло, ок. 50×40, 1980-е",
    badge: "AK",
    media: PIXEL,
    ink: "#171615",
    muted: "#79716b",
    accent: "#A05339",
    background: "#E9E7E6",
    font: { family: "Card Test", bytes: FONT, weight: 800 },
  },
  { title: "No picture, no subtitle", font: { family: "Card Test", bytes: FONT } },
];

{
  const first = await renderCards(cards);
  const second = await renderCards(cards);
  const sizes = first.map(pngSize);
  writeFileSync(join(work, "card-0.png"), first[0]!);
  writeFileSync(join(work, "card-1.png"), first[1]!);
  if (sizes.every(([w, h]) => w === CARD.width && h === CARD.height))
    ok("renderCards: 1200×630", `${first.length} cards, one browser, ${first.map((png) => `${(png.length / 1024).toFixed(0)} KB`).join(" and ")}`);
  else bad("renderCards: 1200×630", JSON.stringify(sizes));
  if (first.every((png, i) => Buffer.from(png).equals(Buffer.from(second[i]!)))) ok("renderCards: two runs, the same bytes", "cmp");
  else bad("renderCards: two runs, the same bytes", "the PNGs differ between runs");
  console.log(`     ${work}/card-0.png, card-1.png`);
}

// ---- (d): the browser's own wrapping, on the longest real title ---------------------------------------------------------

{
  // the longest title in kocharin.art's index, as the PDS served it (89 records, 2026-11-15)
  const longest = "РОМАНТИЧЕСКИЕ ПРИТЧИ, ИЛИ РАЗМЫШЛЕНИЯ О ХУДОЖНИКЕ АЛЕКСЕЕ КОЧАРИНЕ";
  const html = cardHtml({
    title: longest,
    subtitle: "Печатная графика, 3/4, Бумага/Офорт, ок. 15×20, 1984",
    badge: "AK",
    media: PIXEL,
    font: { family: "Card Test", bytes: FONT, weight: 800 },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: CARD, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const card = await page.evaluate(() => {
      const text = document.querySelector(".text") as HTMLElement;
      const h1 = document.querySelector("h1") as HTMLElement;
      const p = document.querySelector("p") as HTMLElement | null;
      // a client rect a line: the browser's own line boxes, not an estimate
      const lines = h1.getClientRects().length;
      const range = document.createRange();
      range.selectNodeContents(h1);
      return {
        lines: range.getClientRects().length || lines,
        title: h1.getBoundingClientRect(),
        subtitle: p?.getBoundingClientRect(),
        textHeight: text.clientHeight,
        contentHeight: text.scrollHeight,
        card: document.scrollingElement!.scrollHeight,
        family: getComputedStyle(h1).fontFamily,
      };
    });
    const fits = card.title.bottom <= card.subtitle!.top + 0.5 && (card.subtitle?.bottom ?? 0) <= card.textHeight;
    if (card.lines >= 2 && fits && card.contentHeight <= card.textHeight && card.card === CARD.height)
      ok(
        "the longest title wraps inside the card",
        `${longest.length} chars, ${card.lines} lines, title ${card.title.width.toFixed(0)}×${card.title.height.toFixed(0)}, ` +
          `subtitle to y=${card.subtitle!.bottom.toFixed(0)} of ${card.textHeight}, no overflow`,
      );
    else
      bad(
        "the longest title wraps inside the card",
        `${card.lines} lines, title ${JSON.stringify(card.title)}, subtitle ${JSON.stringify(card.subtitle)}, ` +
          `content ${card.contentHeight} of ${card.textHeight}, card ${card.card}`,
      );
    if (/Card Test/.test(card.family)) ok("the font is the card's", card.family);
    else bad("the font is the card's", card.family);
  } finally {
    await browser.close();
  }
}

console.log(`\nsolid/card.test.ts: ${checks} checks, ${failed} failed`);
if (failed) process.exit(1);
