// The Sky page: csssky's home feed as a phone-shaped page (360x760), the first real app on this renderer. The bar has the
// wordmark and the three feeds as a headless tablist (roving focus, arrows switch the feed), the feed is one Clay clip
// element that the wheel scrolls (as on the List page), and each post is a card with a drawn avatar, a name and handle, a
// wrapped body, the media line and the counts. The data is the app's recorded fixtures, verbatim (the same six posts
// terminal/sky.c carries): times are the app's ago() with the clock pinned to the fixtures' capture moment, so a frame
// reads the same today as it did when recorded, and News has no fixture, so its feed is the app's empty case.
//
// The palette is terminal/sky_styles.ts's (apps/csssky-tui's styles.ts, read only): the sky palette in the dark theme here,
// the light one under THEME=light.
// A card click records the selection in a signal and nothing more: there is no thread screen yet. The body is the first
// text on these pages that wraps: it is a text in a stretch box in a card of percent width, and Clay wraps a text
// element only when something constrains its width (a clip element lets its children grow past the viewport).
import * as css from "cssints/clay" with { type: "cssints" };
import { createSignal } from "solid-js";

import { a11y } from "../a11y.ts";
import { createTabs } from "../../headless/src/index.ts";
import { ui } from "../src/ffi.ts";
import type { FocusPart, Input } from "../src/input.ts";

// the sky palette: the page, the card one tonal step above it, the hover step, the muted step and the accent blue; the
// ring is the same blue the other pages use.
const t = css.createTokens({
  color: {
    $type: "color",
    page: { $value: "rgb(16 19 22)" },
    panel: { $value: "rgb(23 27 32)" },
    hover: { $value: "rgb(34 40 49)" },
    ink: { $value: "rgb(230 233 236)" },
    muted: { $value: "rgb(139 152 165)" },
    accent: { $value: "rgb(59 156 240)" },
    ring: { $value: "rgb(92 176 255)" },
  },
});
css.createGlobalTheme(t, "light", {
  color: {
    page: "rgb(243 245 247)",
    panel: "rgb(255 255 255)",
    hover: "rgb(232 238 244)",
    ink: "rgb(15 20 25)",
    muted: "rgb(86 99 111)",
    accent: "rgb(17 112 207)",
    ring: "rgb(11 98 189)",
  },
});
const font = css.fonts("Roboto");

const root = css.cn(css.width("stretch"), css.height("stretch"), css.flexDirection("column"), css.bg(t.color.page));

// the bar: the wordmark in the accent, then the tablist. The active tab is the accent with the app's 2px underline, and
// a hover lightens the one under the pointer (Clay draws a border inside the box, so the underline moves no layout).
const bar = css.cn(css.width("stretch"), css.height(64), css.p(0, 16), css.gap(20), css.alignItems("center"), css.bg(t.color.page));
const wordmark = css.cn(font.Roboto, css.color(t.color.accent), css.fontSize(24));
const tablist = css.cn(css.gap(2), css.alignItems("center"));
const tab = css.cn(
  css.p(6, 10),
  css.borderRadius(8),
  css.hover(css.bg(t.color.hover)),
  css.focus(css.border(2, t.color.ring)),
);
// the app's underline: a 2px bottom border, square corners so the border does not curve around the whole tab (a rounded
// border with one side is drawn as a ring and leaves faint arcs along the other corners)
const tabOn = css.cn(tab, css.borderRadius(0), css.borderWidth(0, 0, 2, 0), css.borderColor(t.color.accent));
const tabText = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(15));
const tabTextOn = css.cn(font.Roboto, css.color(t.color.accent), css.fontSize(15));

// the feed: one clip element, the rest of the window's height, with the bar and the status line as its siblings, so they
// stay put when the wheel scrolls it. No height of its own: `stretch` takes what the bar and the status leave, which is
// why it scrolls on the Science feed and not on Discover's three short posts.
const view = css.cn(
  css.width("stretch"),
  css.height("stretch"),
  css.p(12),
  css.gap(8),
  css.flexDirection("column"),
  css.overflow("hidden"),
  css.bg(t.color.page),
  css.focus(css.border(2, t.color.ring)),
);

// a card: the panel, 12px radius and padding, a column of avatar, identity, body, media and counts. The selected card is
// the hover panel with an accent border (a border draws inside, so it moves nothing); the hover lightens the panel.
const card = css.cn(
  // a percent width: a clip element lets its children grow past the viewport for their content, so a card that must
  // wrap its body takes the feed's width from the parent, not from what its text wants
  css.width("100%"),
  css.p(12),
  css.gap(8),
  css.flexDirection("column"),
  css.bg(t.color.panel),
  css.borderRadius(12),
  css.hover(css.bg(t.color.hover)),
);
const cardOn = css.cn(card, css.bg(t.color.hover), css.border(1, t.color.accent));
// the app's one <text> of spans, split in two here: a name and handle side by side do not fit a 312px card (the longest
// pair is about 340px) and Clay has no ellipsis, so the handle and age take the line under the name
const nameLine = css.cn(css.width("stretch"), css.flexDirection("column"));
const name = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(16), css.lineHeight(22));
const meta = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(12), css.lineHeight(16));
// the body's text sits in a stretch box inside the percent-width card: the card puts the width on the box, the box on
// the text, and only then does Clay wrap it
const bodyBox = css.cn(css.width("stretch"));
const body = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(14), css.lineHeight(20), css.whiteSpace("normal"));
// a media line wraps at spaces. Clay breaks only at spaces, so a media line must not contain a word wider than the card
// (a sixty-character URL would run over the gutter): the app's own fallback for a link with no title is the host, which
// is what the Science post carries here.
const media = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(13), css.lineHeight(18), css.whiteSpace("normal"));
const counts = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(13), css.lineHeight(18));

// the empty feed: the app's own line, centred in the viewport
const empty = css.cn(css.width("100%"), css.height("stretch"), css.justifyContent("center"), css.alignItems("center"));
const emptyText = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(14));

const status = css.cn(css.width("stretch"), css.height(32), css.p(0, 16), css.alignItems("center"), css.bg(t.color.page));
const statusText = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(12));

export const s = {
  t,
  font,
  root,
  bar,
  wordmark,
  tablist,
  tab,
  tabOn,
  tabText,
  tabTextOn,
  view,
  card,
  cardOn,
  nameLine,
  name,
  meta,
  bodyBox,
  body,
  media,
  counts,
  empty,
  emptyText,
  status,
  statusText,
};

/** The phone: the bar (64) and the status line (32) around a feed that takes the rest of 760. */
export const size = { width: 360, height: 760 };

/** The fixtures' capture moment (2026-10-02T15:39:31Z): ago() is measured against this, never the clock. */
export const SKY_NOW = 1790955571;

/** The app's ago(), as terminal/format.c: now, 5m, 3h, 2d, then the date. */
export function ago(created: number): string {
  const s = Math.max(0, SKY_NOW - created);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  const d = new Date(created * 1000);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]!;
  const now = new Date(SKY_NOW * 1000);
  return d.getUTCFullYear() === now.getUTCFullYear()
    ? `${month} ${d.getUTCDate()}`
    : `${month} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** Intl's compact notation, as terminal/format.c's sky_num(): 999, 3.5K, 21K, 1M. */
export function num(v: number, unit = 1000, suffix = "K"): string {
  if (unit === 1000 && v < 1000) return String(v);
  const x = v / unit;
  if (x < 10) {
    const s = (Math.round(x * 10) / 10).toFixed(1);
    return (s.endsWith(".0") ? s.slice(0, -2) : s) + suffix;
  }
  const r = Math.round(x);
  if (r >= 1000 && unit === 1000) return num(v, 1e6, "M");
  return `${r}${suffix}`;
}

/** One post of a feed: the record's fields as the fixtures carry them (terminal/sky.c's SkyPost). */
interface Post {
  readonly name: string; // "" when the record has no display name: the handle is the name then
  readonly handle: string;
  readonly text: string;
  readonly media?: string;
  readonly replies: number;
  readonly reposts: number;
  readonly likes: number;
  readonly created: number;
}

interface Feed {
  readonly name: string;
  readonly posts: readonly Post[];
}

// apps/csssky/test/fixtures/home-discover-1.json (feed[20], [23], [9])
const DISCOVER: readonly Post[] = [
  {
    name: "Michael Warburton",
    handle: "michaelwarburton.bsky.social",
    text: "René Magritte at work in his living room in 1964",
    media: "[image]",
    replies: 8,
    reposts: 32,
    likes: 310,
    created: 1790948585,
  },
  {
    name: "Titania",
    handle: "titaniasrealm.bsky.social",
    text: "The Witch's Cat (1955) by Hilda Boswell",
    media: "[image: Painting of a witch riding a broom above rooftops. A cat is watching her.]",
    replies: 3,
    reposts: 27,
    likes: 128,
    created: 1790953138,
  },
  {
    name: "",
    handle: "alexjungle.bsky.social",
    text: "A man in China dislocates his shoulder playing basketball, and a foreigner saves the day.",
    media: "[video]",
    replies: 7,
    reposts: 61,
    likes: 357,
    created: 1790949554,
  },
];
// apps/csssky/test/fixtures/home-science-1.json (feed[11], [13], [25])
const SCIENCE: readonly Post[] = [
  {
    name: "Erik Strub",
    handle: "erikstrub.bsky.social",
    text:
      "Second paper of Marco (open access) on Tc-99m is online, congrats! Good timing for the weekend.\n\n" +
      "www.sciencedirect.com/science/arti...",
    media: "[link: sciencedirect.com]", // the app's external embed with no title: the host, not a 60-char URI
    replies: 0,
    reposts: 0,
    likes: 0,
    created: 1790955571,
  },
  {
    name: "David Blanchflower BSc",
    handle: "davidbflower.bsky.social",
    text: "Tonight Mars continues to near the Beehive Cluster. Early on Monday morning joined by the Waning Crescent Moon.",
    replies: 0,
    reposts: 1,
    likes: 6,
    created: 1790955129,
  },
  {
    name: "Jason GRIZZLED Bittel",
    handle: "bittelmethis.bsky.social",
    text: "Wondering what the big deal is about a few little bugs? Here's why the wine and beer industries are worried about spotted lanternflies!",
    media: "[link: Invasive spotted lanternflies seen in New York's wine region - nationalgeographic.com]",
    replies: 1,
    reposts: 1,
    likes: 3,
    created: 1790952698,
  },
];
const FEEDS: readonly Feed[] = [
  { name: "Discover", posts: DISCOVER },
  { name: "Science", posts: SCIENCE },
  { name: "News", posts: [] },
];

const VIEW = "sky-feed";
// The avatars: the committed 64x64 PNGs (examples/sky/avatars.py) drawn at 40x40. A css style is evaluated when the
// module loads, so each author is a style of its own with a literal path; a page cannot build one from a loop variable.
const SKY = new URL("../../examples/sky/", import.meta.url).pathname;
const AVATARS: Record<string, css.ClayStyle> = {
  michaelwarburton: css.image(`${SKY}michaelwarburton.png`, { width: 40, height: 40 }),
  titaniasrealm: css.image(`${SKY}titaniasrealm.png`, { width: 40, height: 40 }),
  alexjungle: css.image(`${SKY}alexjungle.png`, { width: 40, height: 40 }),
  erikstrub: css.image(`${SKY}erikstrub.png`, { width: 40, height: 40 }),
  davidbflower: css.image(`${SKY}davidbflower.png`, { width: 40, height: 40 }),
  bittelmethis: css.image(`${SKY}bittelmethis.png`, { width: 40, height: 40 }),
};

/**
 * The page. Two Tab stops: the tablist (one stop on the active tab, arrows move and switch) and the feed. The feed's keys
 * scroll it: Down and Up 40px, PageDown and PageUp a viewport, Home and End to the ends, all through `ui.scroll_to` so
 * Clay clamps them to the content (the List page's way). The wheel scrolls the feed under the pointer (Clay's own), and
 * a card press only records the selection until there is a thread screen to open.
 */
export function Sky(props: { input: Input }) {
  const { input } = props;
  const [focused, setFocused] = createSignal(false);
  const [selected, setSelected] = createSignal<{ feed: number; i: number } | null>(null);

  // the tablist is the page's first stop and the feed the second. The panels are not stops of their own: the feed is one
  // (the tabs' `focusablePanels` says so, or Tab would land on a panel the page draws no box for).
  const tabs = createTabs({ id: "sky-tabs", items: FEEDS.length, focus: input.focus, focusablePanels: [0, 1, 2] });
  const binds = tabs.tabs.map((tab) => input.bind(tab));
  const active = () => tabs.selected();
  const feed = () => FEEDS[active()]!;

  /** Scrolls the feed to `y` (ui.c clamps it to the content: 0 at the top, the last screenful at the bottom). */
  const scroll = (y: number) => ui.scrollTo(VIEW, y);

  const part: FocusPart & { readonly disabled: boolean } = {
    id: VIEW,
    disabled: false,
    get focused() {
      return focused();
    },
    focus: () => setFocused(true),
    blur: () => setFocused(false),
    keyDown: (key) => {
      const offset = ui.scrollOffset(VIEW);
      const page = ui.bounds(Buffer.from(VIEW))?.[3] ?? 0;
      // the offset is negative going down (Clay's), so Down subtracts
      const step = key === "ArrowDown" ? -40 : key === "ArrowUp" ? 40 : key === "PageDown" ? -page : key === "PageUp" ? page : 0;
      if (key === "Home") scroll(0);
      else if (key === "End") scroll(-1e6);
      else if (!step) return false;
      else scroll(offset + step);
      return true;
    },
    keyUp: () => false,
  };
  const bind = input.add(part);

  const statusOf = () => {
    const f = feed();
    const sel = selected();
    if (sel && sel.feed === active()) {
      const p = f.posts[sel.i]!;
      return `${p.name || p.handle} — ${sel.i + 1} of ${f.posts.length}`;
    }
    return `${f.name} — ${f.posts.length} ${f.posts.length === 1 ? "post" : "posts"}`;
  };

  return (
    <box id="Root" style={s.root}>
      <box id="sky-bar" style={s.bar}>
        <text style={s.wordmark}>sky</text>
        <box {...a11y(tabs.tablist)} style={s.tablist}>
          {tabs.tabs.map((tab, i) => (
            <box {...binds[i]!} {...a11y(tab)} style={tab.selected ? s.tabOn : s.tab}>
              <text style={tab.selected ? s.tabTextOn : s.tabText}>{FEEDS[i]!.name}</text>
            </box>
          ))}
        </box>
      </box>
      <box {...bind} style={s.view}>
        {feed().posts.map((p, i) => (
          <box
            id={`sky-card-${i}`}
            style={selected()?.feed === active() && selected()?.i === i ? s.cardOn : s.card}
            onClick={() => setSelected({ feed: active(), i })}
          >
            <box id={`sky-avatar-${i}`} style={AVATARS[p.handle.split(".")[0]!]!} />
            <box style={s.nameLine}>
              <text style={s.name}>{p.name || p.handle}</text>
              <text style={s.meta}>{p.name ? `@${p.handle} · ${ago(p.created)}` : ago(p.created)}</text>
            </box>
            <box id={`sky-body-${i}`} style={s.bodyBox}>
              <text style={s.body}>{p.text}</text>
            </box>
            {p.media ? <text style={s.media}>{p.media}</text> : null}
            <text style={s.counts}>{`${num(p.replies)} replies · ${num(p.reposts)} reposts · ${num(p.likes)} likes`}</text>
          </box>
        ))}
        {feed().posts.length === 0 ? (
          <box id="sky-empty" style={s.empty}>
            <text style={s.emptyText}>Nothing here yet</text>
          </box>
        ) : null}
      </box>
      <box id="sky-status" style={s.status}>
        <text style={s.statusText}>{statusOf()}</text>
      </box>
    </box>
  );
}
