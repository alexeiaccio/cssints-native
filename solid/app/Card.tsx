// The Card page: the social card `src/card/card.ts` writes as HTML, declared as Clay's boxes and texts and drawn by the
// host — the same card without Chromium, at any page size. The geometry is the HTML's at scale 1: the text column is what
// the picture leaves, half the card by default, 36px of padding, the badge at the top and the title over the subtitle at
// the bottom, the picture contained in its own box over the work's dominant colour.
//
// **The scale.** A 1920×1080 card with 36px type is a card seen from far away, so every literal here is that literal times
// `scale` — half the card's width unless a caller says otherwise. The boxes take the channel (`ui.value`), because a style
// is a literal; the type takes `mergeText`, because Clay's text config is a value the renderer reads per element.
//
// What is not the HTML's: there is no ellipsis (Clay wraps and clips, it does not cut a word and add "…"), and the badge's
// −5° tilt is the channel's `ROTATE` rather than a style, so it is a transform of the drawn group, not of the layout.
import * as css from "cssints/clay" with { type: "cssints" };

import { createSignal } from "solid-js";

import type { Motion } from "../src/entry.ts";
import { ui } from "../src/ffi.ts";
import { FIELDS, type TextOverride } from "../src/pack.ts";

/** The card's size in pixels at scale 1: the 1.91:1 Open Graph size, unless `--w`/`--h` say otherwise. */
export const CARD = { width: 1200, height: 630 } as const;

const t = css.createTokens({
  color: {
    $type: "color",
    page: { $value: "rgb(243 245 247)" },
    ink: { $value: "rgb(15 20 25)" },
    muted: { $value: "rgb(86 99 111)" },
    accent: { $value: "rgb(17 112 207)" },
  },
});
const font = css.fonts("Roboto");

const root = css.cn(css.width("stretch"), css.height("stretch"), css.flexDirection("row"), css.bg(t.color.page));
// The column is the card's height and starts at its top edge, so a title that does not fit runs off the card and is cut
// by the frame. Not by `overflow: hidden`: a clip on the box that holds the text stops Clay wrapping the text at that
// box's width, and a card whose title does not wrap is a card with one long line. A box that clips and a box that wraps
// have to be two boxes, and clipping the outer one flattens the inner one's width the same way — so the frame is the clip.
const textColumn = css.cn(css.width("stretch"), css.height("stretch"), css.p(36), css.flexDirection("column"));
// the room between the badge and the lines: a column with no `space-between` in this adapter grows a box instead
const spacer = css.cn(css.width(0), css.height("stretch"));
const badge = css.cn(
  css.width(64),
  css.height(64),
  css.borderRadius(32),
  css.justifyContent("center"),
  css.alignItems("center"),
  css.bg(t.color.accent),
);
const badgeText = css.cn(font.Roboto, css.color(t.color.page), css.fontSize(36), css.lineHeight(36), css.whiteSpace("nowrap"));
const lines = css.cn(css.width("stretch"), css.gap(10), css.flexDirection("column"));
const titleStyle = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(36), css.lineHeight(41), css.whiteSpace("normal"));
const subtitleStyle = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(24), css.lineHeight(30), css.whiteSpace("normal"));
const mutedTitle = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(36), css.lineHeight(41), css.whiteSpace("normal"));
// the picture's column: a fixed share of the card, its own colour behind the work
const media = css.cn(css.height("stretch"), css.justifyContent("center"), css.alignItems("center"));

/** How many lines a card's title and subtitle hold before the ellipsis. The artist's index makes 66 characters of title in
 *  four lines at scale 1 (2026-11-15), so four is what the design carries and one more is what it refuses. */
const MAX_TITLE_LINES = 4;
const MAX_SUBTITLE_LINES = 2;
/** The first frame's guard, a character count: a text longer than the design's lines can hold stops wrapping where the
 *  column does and starts sizing it, and a column sized by its own overflow is a column the picture is drawn over. So the
 *  first frame is cut to about what four lines hold (the index's 66 characters fit with room), and the measurement after
 *  it cuts the rest. */
const FIRST_FRAME = 100;
const FIRST_FRAME_SUBTITLE = 60;

/** The lines a text took, from its box's height over the line height its config rounds to. */
const linesOf = (id: string, lineHeight: number): number | undefined => {
  const bounds = ui.bounds(idBytes(id));
  if (bounds === undefined) return undefined;
  return Math.max(1, Math.round(bounds[3]! / Math.max(1, lineHeight)));
};

/** The text cut to `maxLines` with an ellipsis: the characters kept are that many lines' share of the lines it has. */
const fitLines = (text: string, lines: number, maxLines: number): string => {
  const keep = Math.max(1, Math.floor((text.length * maxLines) / lines) - 1);
  return `${text.slice(0, keep).trimEnd()}…`;
};

const ids = new Map<string, Uint8Array>();
const idBytes = (id: string): Uint8Array => {
  const held = ids.get(id);
  if (held !== undefined) return held;
  const bytes = new TextEncoder().encode(id);
  ids.set(id, bytes);
  return bytes;
};
const put = (id: string, field: number, value: number) => ui.value(idBytes(id), field, value);
/** A FIXED axis through the value channel: the type, then the min and the max. */
const fixed = (id: string, field: number, px: number) => {
  put(id, field, 3);
  put(id, field + 1, px);
  put(id, field + 2, px);
};
/** The four sides of a field that takes them (padding, radius), in the order `ui_open` reads. */
const sides = (id: string, field: number, value: number) => {
  for (let i = 0; i < 4; i++) put(id, field + i, value);
};
/** A `#rrggbb` as the three channels the value channel writes. */
const rgbOf = (value: string): [number, number, number] => {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1] ?? "000000";
  return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
};

export interface CardImage {
  /** The file the host loads: PNG, JPEG, WebP, or an SVG (when the size is given rather than measured). */
  readonly path: string;
  /** The picture's own size, for `contain`: the box a work of other proportions gets. */
  readonly width: number;
  readonly height: number;
}

export interface CardPageProps {
  readonly width?: number;
  readonly height?: number;
  /** The design's scale: `width / 1200` unless the caller names one (a 2× card, a slide's type). */
  readonly scale?: number;
  readonly title: string;
  readonly subtitle?: string;
  readonly badge?: string;
  readonly image?: CardImage;
  /** The box behind the picture: the work's dominant colour, else the card's accent. */
  readonly mediaBackground?: string;
  /** The picture column's width at scale 1: half the card unless given. */
  readonly mediaWidth?: number;
  readonly mutedTitle?: boolean;
  /** The display face of the title and the badge, as `ui_font` numbered it: 0 unless a caller loaded one. */
  readonly titleFont?: number;
  /** The face of the subtitle, `ui_font`'s number: the title's when a site has one display cut and one body cut. */
  readonly bodyFont?: number;
  readonly motion?: Motion;
}

/** The page: the badge at the top, the title and the subtitle at the bottom, the picture in its own column. */
export function Card(props: CardPageProps) {
  const width = props.width ?? CARD.width;
  const height = props.height ?? CARD.height;
  const scale = props.scale ?? width / CARD.width;
  const mediaWidth = props.mediaWidth === undefined ? Math.round(width / 2) : Math.round(props.mediaWidth * scale);
  const image = props.image;
  // contain, in the renderer's terms: the picture's own aspect inside its box, then a fixed box for it
  const fit =
    image === undefined
      ? undefined
      : (() => {
          const factor = Math.min(mediaWidth / image.width, height / image.height);
          return { width: Math.round(image.width * factor), height: Math.round(image.height * factor) };
        })();
  const pad = Math.round(36 * scale);

  // the lines as drawn: the first frame's guard, then what the measurement leaves
  const [title, setTitle] = createSignal(props.title.slice(0, FIRST_FRAME));
  const [subtitle, setSubtitle] = createSignal((props.subtitle ?? "").slice(0, FIRST_FRAME_SUBTITLE));

  if (props.motion) {
    props.motion.tick = () => {
      // the ellipsis: the last frame's lines, cut to the design's — one cut a frame converges, and a text that fits is
      // left alone
      const line = (px: number) => Math.round(px * scale);
      const titleLines = linesOf("card-title-box", line(41));
      if (titleLines !== undefined && titleLines > MAX_TITLE_LINES) setTitle(fitLines(title(), titleLines, MAX_TITLE_LINES));
      const subtitleLines = linesOf("card-subtitle-box", line(30));
      if (subtitleLines !== undefined && subtitleLines > MAX_SUBTITLE_LINES)
        setSubtitle(fitLines(subtitle(), subtitleLines, MAX_SUBTITLE_LINES));

      // the text column's padding, the badge's circle and the gap between the title and the subtitle are the HTML's
      // 36/64/32/10 at this scale; the column's width is what the picture leaves
      sides("card-text", FIELDS.PADDING, pad);
      fixed("card-badge", FIELDS.WIDTH, Math.round(64 * scale));
      fixed("card-badge", FIELDS.HEIGHT, Math.round(64 * scale));
      sides("card-badge", FIELDS.RADIUS, Math.round(32 * scale));
      // the badge's tilt, the HTML card's -5°: the channel's own rotation, about the box's centre
      put("card-badge", FIELDS.ROTATE, -5);
      put("card-lines", FIELDS.GAP, Math.round(10 * scale));
      fixed("card-media", FIELDS.WIDTH, mediaWidth);
      if (fit !== undefined) {
        fixed("card-picture", FIELDS.WIDTH, fit.width);
        fixed("card-picture", FIELDS.HEIGHT, fit.height);
      }
      if (props.mediaBackground !== undefined) {
        const [r, g, b] = rgbOf(props.mediaBackground);
        put("card-media", FIELDS.BACKGROUND, r);
        put("card-media", FIELDS.BACKGROUND + 1, g);
        put("card-media", FIELDS.BACKGROUND + 2, b);
        put("card-media", FIELDS.BACKGROUND + 3, 255);
      }
    };
  }

  // the type: the style's colour, alignment and wrap, at this scale's size
  const type = (size: number, lineHeight: number, fontId?: number): TextOverride => ({
    size: size * scale,
    lineHeight: lineHeight * scale,
    ...(fontId === undefined ? {} : { fontId }),
  });

  return (
    <box style={root}>
      <box id="card-text" style={textColumn}>
        {props.badge ? (
          <box id="card-badge" style={badge}>
            <text style={badgeText} text={type(36, 36, props.titleFont)}>
              {props.badge}
            </text>
          </box>
        ) : null}
        <box style={spacer} />
        <box id="card-lines" style={lines}>
          <box id="card-title-box">
            <text style={props.mutedTitle ? mutedTitle : titleStyle} text={type(36, 41, props.titleFont)}>
              {title()}
            </text>
          </box>
          {props.subtitle ? (
            <box id="card-subtitle-box">
              <text style={subtitleStyle} text={type(24, 30, props.bodyFont)}>
                {subtitle()}
              </text>
            </box>
          ) : null}
        </box>
      </box>
      {image ? (
        <box id="card-media" style={media}>
          <box id="card-picture" image={image.path} />
        </box>
      ) : null}
    </box>
  );
}
