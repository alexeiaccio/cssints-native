// The build half of a card: the same document `./card.ts` makes, printed by Chromium — one browser for a whole site's
// index, so a hundred cards are a few seconds and not a browser each. Kept beside the document rather than in it: this
// module imports Playwright, and a page that only shows a card must not.
import { CARD, cardHtml, type CardInput } from "./card.ts";

export interface CardOptions {
  /** The card's size; `CARD` unless given. `inputs` may also carry their own. */
  readonly size?: { readonly width: number; readonly height: number };
}

/**
 * The cards as PNGs, in the inputs' order: one Chromium, one page, a `setContent` and a screenshot a card. The pictures
 * and the font are data URIs inside the document, so nothing is fetched over the network and the bytes are the same on
 * every run.
 */
export async function renderCards(inputs: readonly CardInput[], options: CardOptions = {}): Promise<Uint8Array[]> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const out: Uint8Array[] = [];
  try {
    let page: Awaited<ReturnType<typeof browser.newPage>> | undefined;
    let opened = "";
    for (const input of inputs) {
      const width = input.size?.width ?? options.size?.width ?? CARD.width;
      const height = input.size?.height ?? options.size?.height ?? CARD.height;
      // a page is the size it was opened at, so a card of another size gets a page of its own
      const key = `${width}x${height}`;
      if (!page || key !== opened) {
        await page?.close();
        page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
        opened = key;
      }
      await page.setContent(cardHtml(input), { waitUntil: "load" });
      // the font and the pictures are in the document; a screenshot before they are decoded is a card of blank boxes
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map((image) => image.decode().catch(() => undefined)));
      });
      out.push(await page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height } }));
    }
  } finally {
    await browser.close();
  }
  return out;
}

/** One card as a PNG: `renderCards` of one. */
export async function renderCard(input: CardInput, options: CardOptions = {}): Promise<Uint8Array> {
  const [png] = await renderCards([input], options);
  return png!;
}
