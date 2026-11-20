// A **social card** from a page's own data: a title, a subtitle, a badge and one picture, 1200×630. This is the card a
// site puts behind `og:image` — not a figure (`./figure/export/og.ts` draws a glyph-kit figure, which has no picture and
// a cell grid of its own).
//
// `cardHtml(input)` is the card as one self-contained document: the picture and the font are data URIs, the styles are in
// a `<style>`, and there is no script — so the browser side of a site can show the same card in an `<iframe srcdoc>`
// without a rasteriser. It imports nothing but its own base64, which is what lets a page bundle it; the raster half is
// `./render.ts` (Chromium), a module a page never pulls.
//
// The layout is the common one, and the reason it is HTML and not SVG: the browser **wraps the text with the font's real
// metrics**. A 66-character Cyrillic title at 36px is three lines in a 500px column, and guessing that from character
// counts would be a different card. The picture takes the right half (`mediaWidth`, 630 of 1200 by default) over its own
// dominant colour, and the left column is the badge at the top and the title over the subtitle at the bottom.
import { base64 } from "./base64.ts";

/** The card's size in pixels: the 1.91:1 Open Graph size every scraper documents. */
export const CARD = { width: 1200, height: 630 } as const;

/** A picture: a URL the renderer can fetch, its bytes, or bytes with an explicit type. */
export type CardImage = string | Uint8Array | { bytes: Uint8Array; type?: string };

/** A font: the bytes of a file (a browser page passes them too), or a URL / data URI a page can load itself. */
export interface CardFont {
  /** The family the card is set in: what `<style>`'s `font-family` names. */
  readonly family: string;
  /** The font's bytes: `woff2`, `ttf` or `otf` — sniffed, no extension needed. */
  readonly bytes?: Uint8Array;
  /** ... or a URL or data URI to the file, when the page can fetch it. */
  readonly src?: string;
  /** The weight the face is declared at: 400 unless given, 800 for a display cut. */
  readonly weight?: number;
}

export interface CardInput {
  readonly title: string;
  /** The line under the title: a medium, a date, a section. */
  readonly subtitle?: string;
  /** The mark in the top-left corner: two letters, a monogram. */
  readonly badge?: string;
  /** The picture on the right; without one the card is the text column alone. */
  readonly media?: CardImage;
  /** The box behind the picture: the work's dominant colour, else `accent`. */
  readonly mediaBackground?: string;
  /** `contain` keeps the whole work and lets the box show; `cover` fills the box and crops. Contain by default. */
  readonly mediaFit?: "contain" | "cover";
  /** The text's colour; `mutedTitle` draws an untitled work in the subtitle's grey. */
  readonly ink?: string;
  readonly muted?: string;
  readonly background?: string;
  readonly accent?: string;
  readonly mutedTitle?: boolean;
  readonly font?: CardFont;
  /**
   * The **display** face: the title's and the badge's. A site's own headings are rarely its body face — the brand's
   * cut is what a card wants at 36px — and the subtitle keeps `font`. Without one the title is set in `font`.
   */
  readonly display?: CardFont;
  readonly size?: { readonly width: number; readonly height: number };
  /** The picture column's width in pixels: half the card unless given. */
  readonly mediaWidth?: number;
}

const DEFAULTS = {
  ink: "#0f1419",
  muted: "#56636f",
  background: "#f3f5f7",
  accent: "#1170cf",
} as const;

/** XML/HTML text: the five characters that would break the page, and nothing else. */
const esc = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** A picture's type from its first bytes: the three a site's images are, and a last resort. */
function typeOf(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "image/webp";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  return "application/octet-stream";
}

/** A font's type from its first bytes: woff2 and woff wrap the face, ttf/otf are the face. */
function fontTypeOf(bytes: Uint8Array): string {
  if (bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x32) return "font/woff2";
  if (bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x46) return "font/woff";
  if (bytes[0] === 0x4f && bytes[1] === 0x54 && bytes[2] === 0x54 && bytes[3] === 0x4f) return "font/otf";
  return "font/ttf";
}

const dataUri = (type: string, bytes: Uint8Array): string => `data:${type};base64,${base64(bytes)}`;

/** A picture as a URL: its own if it is one, else its bytes as a data URI. */
const imageSrc = (image: CardImage): string => {
  if (typeof image === "string") return image;
  const bytes = image instanceof Uint8Array ? image : image.bytes;
  const type = image instanceof Uint8Array ? typeOf(image) : (image.type ?? typeOf(image.bytes));
  return dataUri(type, bytes);
};

const FALLBACK = "Roboto, Helvetica, Arial, sans-serif";

/**
 * One card as a self-contained HTML document: no script, no external stylesheet, and the picture and the font inline —
 * what `--og` prints, what a site's editor shows in an `<iframe srcdoc>`.
 */
export function cardHtml(input: CardInput): string {
  const width = input.size?.width ?? CARD.width;
  const height = input.size?.height ?? CARD.height;
  const ink = input.ink ?? DEFAULTS.ink;
  const muted = input.muted ?? DEFAULTS.muted;
  const background = input.background ?? DEFAULTS.background;
  const accent = input.accent ?? DEFAULTS.accent;
  const mediaWidth = input.mediaWidth ?? Math.round(width / 2);
  // the text column is what the picture leaves, and it too is measured in the card's own pixels
  const textWidth = width - mediaWidth;
  const font = input.font;
  const display = input.display ?? font;
  const srcOf = (f: CardFont | undefined) =>
    f ? (f.bytes ? dataUri(fontTypeOf(f.bytes), f.bytes) : f.src) : undefined;
  const familyOf = (f: CardFont | undefined) => (f ? `'${f.family.replace(/'/g, "")}', ${FALLBACK}` : FALLBACK);
  /** One `@font-face` a face: the display's only when it is a face of its own. */
  const faceOf = (f: CardFont | undefined) =>
    f && srcOf(f)
      ? `@font-face { font-family: '${esc(f.family)}'; font-weight: ${f.weight ?? 400}; font-style: normal; src: url(${srcOf(f)}); }\n`
      : "";
  const face = faceOf(font);
  const displayFace = display === font ? "" : faceOf(display);
  const family = familyOf(font);
  const displayFamily = familyOf(display);
  const weight = font?.weight ?? 400;
  const displayWeight = display?.weight ?? weight;
  const titleColor = input.mutedTitle ? muted : ink;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(input.title)}</title>
<style>
${face}${displayFace}* { box-sizing: border-box; }
html, body { margin: 0; width: ${width}px; height: ${height}px; }
body { background: ${background}; color: ${ink}; font-family: ${family}; overflow: hidden; }
main { display: flex; width: 100%; height: 100%; }
.text {
  width: ${textWidth}px;
  height: 100%;
  padding: 36px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
}
.badge {
  width: 64px; height: 64px; border-radius: 50%;
  background: ${accent}; color: ${background};
  display: flex; align-items: center; justify-content: center;
  font-family: ${displayFamily}; font-size: 36px; font-weight: ${displayWeight}; line-height: 1;
  transform: rotate(-5deg);
  flex: none;
}
.lines { min-height: 0; }
h1 { margin: 0; font-family: ${displayFamily}; font-size: 36px; line-height: 1.15; font-weight: ${displayWeight}; color: ${titleColor}; }
p { margin: 0.4em 0 0; font-size: 24px; line-height: 1.25; font-weight: ${weight}; color: ${muted}; }
.media {
  width: ${mediaWidth}px; height: 100%;
  background: ${input.mediaBackground ?? accent};
  display: flex; align-items: center; justify-content: center;
  flex: none;
}
.media img { width: 100%; height: 100%; object-fit: ${input.mediaFit ?? "contain"}; display: block; }
</style>
</head>
<body>
<main>
<div class="text">
${input.badge ? `<div class="badge">${esc(input.badge)}</div>` : "<span></span>"}
<div class="lines">
<h1>${esc(input.title)}</h1>
${input.subtitle ? `<p>${esc(input.subtitle)}</p>` : ""}
</div>
</div>
${input.media ? `<div class="media"><img src="${esc(imageSrc(input.media))}" alt=""></div>` : ""}
</main>
</body>
</html>
`;
}
