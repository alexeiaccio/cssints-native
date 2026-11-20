// The Figure card page: one spec as the 1200×630 social card the figure's `--og` writes — the title, the intent, the
// figure filling the room left and keeping its aspect, the source at the bottom. It is `src/figure/export/og.ts`'s HTML
// card, declared as Clay's boxes and texts and drawn by the host, so `--og` needs no Chromium.
//
// The figure arrives as the spec's own SVG (`svg(spec)`), a picture like any other: the box is the room the column leaves,
// and the picture inside it is the aspect the SVG's viewBox has, computed from the room's bounds — the layout's, read from
// the previous frame by `ui.bounds`, because the room is what is left after the header wraps and no literal knows it.
//
// **The scale.** The card is the Open Graph size at scale 1 and `1200·s × 630·s` at `s`: the padding, the gaps, the
// intent's 62ch column and every type size are the HTML's numbers times `s`, the boxes through the channel and the type
// through `mergeText` — the same two doors `app/Card.tsx` uses.
//
// The palette is the dark one, as the HTML card's is (`FIGURE_ROLES`, `color-scheme: dark`): the figure is drawn for a dark
// page and its SVG carries that page as its own first rectangle, so the card behind it is the same colour.
import * as css from "cssints/clay" with { type: "cssints" };

import type { Motion } from "../src/entry.ts";
import { ui } from "../src/ffi.ts";
import { FIELDS, type TextOverride } from "../src/pack.ts";

/** The card's size: the Open Graph one, the size `figure.ts --og` writes. */
export const size = { width: 1200, height: 630 };

const t = css.createTokens({
  color: {
    $type: "color",
    page: { $value: "rgb(16 19 22)" },
    ink: { $value: "rgb(230 233 236)" },
    muted: { $value: "rgb(139 152 165)" },
  },
});
const font = css.fonts("Roboto");

// the HTML card's numbers: main's 56px by 64px and 18px gap, the h1 at 44/51, the intent at 19/27 in 62ch (655px of Roboto
// at 19px), the caption at 16/22, and 14px between the figure's room and the caption
const root = css.cn(
  css.width("stretch"),
  css.height("stretch"),
  css.flexDirection("column"),
  css.paddingTop(56),
  css.paddingBottom(56),
  css.paddingLeft(64),
  css.paddingRight(64),
  css.gap(18),
  css.bg(t.color.page),
);
const header = css.cn(css.width("stretch"), css.flexDirection("column"));
const room = css.cn(css.width("stretch"), css.height("stretch"), css.justifyContent("center"), css.alignItems("center"));
// the figure's block: the room it fills and the caption under it, 14px apart — one flex child of the page, so the root's
// 18px gap is between the header and this block once, as the HTML's `figure` is
const figureBlock = css.cn(css.width("stretch"), css.height("stretch"), css.flexDirection("column"), css.gap(14));
const titleText = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(44), css.lineHeight(51), css.whiteSpace("normal"));
const intentText = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(19), css.lineHeight(27), css.whiteSpace("normal"));
const captionText = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(16), css.lineHeight(22), css.whiteSpace("normal"));
const intentBox = css.cn(css.width(655), css.flexDirection("column"));

const idBytes = (id: string) => new TextEncoder().encode(id);
const put = (id: string, field: number, value: number) => ui.value(idBytes(id), field, value);
const fixed = (id: string, field: number, px: number) => {
  put(id, field, 3);
  put(id, field + 1, px);
  put(id, field + 2, px);
};

export interface FigureCardPicture {
  /** The spec's SVG: the file `main.ts` wrote for this card. */
  readonly path: string;
  /** The figure's own size, its viewBox: cells × 8 across and × 16 down. */
  readonly width: number;
  readonly height: number;
}

export interface FigureCardProps {
  /** The design's multiple: 1 is the Open Graph card, 2 a 2400×1260 one. The page's size is this times `size`. */
  readonly scale?: number;
  readonly title: string;
  readonly intent?: string;
  readonly source?: string;
  readonly picture: FigureCardPicture;
  readonly motion?: Motion;
}

export function FigureCard(props: FigureCardProps) {
  const picture = props.picture;
  const scale = props.scale ?? 1;
  /** A size or a gap at this scale, a whole number of pixels: Clay's padding, line height and font size are integers. */
  const at = (px: number) => Math.round(px * scale);
  const type = (size: number, lineHeight: number): TextOverride => ({ size: at(size), lineHeight: at(lineHeight) });

  if (props.motion) {
    props.motion.tick = () => {
      // the page's own numbers, at this scale: 56 by 64 of padding, 18 between the header and the figure, 14 over the
      // caption, and the intent's 62ch (655px of Roboto at 19px)
      put("fcard", FIELDS.PADDING, at(64));
      put("fcard", FIELDS.PADDING + 1, at(64));
      put("fcard", FIELDS.PADDING + 2, at(56));
      put("fcard", FIELDS.PADDING + 3, at(56));
      put("fcard", FIELDS.GAP, at(18));
      put("fcard-block", FIELDS.GAP, at(14));
      fixed("fcard-intent", FIELDS.WIDTH, at(655));
      // the room the header and the caption leave: the last layout's, which is why the saved frame is the second one
      const bounds = ui.bounds(idBytes("fcard-room"));
      if (bounds === undefined) return;
      const [, , width, height] = bounds as unknown as [number, number, number, number];
      if (!width || !height) return;
      const factor = Math.min(width / picture.width, height / picture.height);
      fixed("fcard-picture", FIELDS.WIDTH, Math.round(picture.width * factor));
      fixed("fcard-picture", FIELDS.HEIGHT, Math.round(picture.height * factor));
    };
  }
  return (
    <box style={root}>
      <box id="fcard-header" style={header}>
        <text id="fcard-title" style={titleText}>{props.title}</text>
        {props.intent ? (
          <box style={intentBox}>
            <text style={intentText}>{props.intent}</text>
          </box>
        ) : null}
      </box>
      <box id="fcard-block" style={figureBlock}>
        <box id="fcard-room" style={room}>
          <box id="fcard-picture" image={picture.path} />
        </box>
        {props.source ? (
          <text style={captionText} text={type(16, 22)}>
            {props.source}
          </text>
        ) : null}
      </box>
    </box>
  );
}
