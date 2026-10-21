// apps/csssky-tui's home screen in cells (css-in-ts-compiler/apps/csssky-tui/src/App.tsx, read only): the bar with the
// three feed tabs, the list of post cards, and the footer, laid out by Clay from the same styles (sky_styles.ts is that
// file's styles.ts in cssints/clay) and drawn by render.c into cells.
//
// The data is the app's own recorded fixtures, verbatim (apps/csssky/test/fixtures/home-discover-1.json and
// home-science-1.json): three posts of Discover and three of Science, the counts, the media lines model.ts makes
// ("[image: alt]", "[link: title - host]"). News has no fixture, so its feed is the app's empty case: one row, the
// HomeScreen's "Nothing here yet". Times are the app's ago() with now pinned to the fixtures' capture moment
// (2026-10-02T15:39:31Z) instead of the clock, so a frame is the same today as it was recorded.
//
// Behaviour: j/k or the arrows move the selection (per feed, as the app's store does), tab/shift-tab and 1-3 switch
// feeds, t the theme, q quits (the host's), and a click on a tab switches to it and a click on a row selects it.
//
// What a cell cannot carry, and what is not here: the thread screen (enter only selects, so a row cannot be opened),
// wrapping (the body is one clipped row), bold and underline (the name and the link are colours only), the pointer
// cursor, images (a media line instead, as the app already does), the system theme of src/system.ts (it solves roles
// from the terminal's palette at run time; the port has styles.ts's dark and light themes), scrolling by the wheel or
// by dragging, and hover that follows the mouse without a click (termbox2 reports no motion events).
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

#include "cells.h"
#include "page.h"
#include "sky_styles.h"

#define SKY_NOW 1790955571LL // 2026-10-02T15:39:31Z: the moment the fixtures were recorded

typedef struct {
    const char *name; // displayName; "" when the post has none, and the handle is the name then
    const char *handle;
    const char *text;  // the record's text verbatim
    const char *media; // model.ts's mediaText, or NULL
    int replies, reposts, likes;
    long long created; // the record's createdAt, in seconds
} SkyPost;

typedef struct {
    const char *name;
    const SkyPost *posts;
    int count;
} SkyFeed;

// home-discover-1.json, feed[20], [23], [9]
static const SkyPost DISCOVER[] = {
    {"Michael Warburton", "michaelwarburton.bsky.social", "Ren\u00e9 Magritte at work in his living room in 1964",
     "[image]", 8, 32, 310, 1790948585LL},
    {"Titania", "titaniasrealm.bsky.social", "The Witch's Cat (1955) by Hilda Boswell",
     "[image: Painting of a witch riding a broom above rooftops. A cat is watching her.]", 3, 27, 128, 1790953138LL},
    {"", "alexjungle.bsky.social",
     "A man in China dislocates his shoulder playing basketball, and a foreigner saves the day.", "[video]", 7, 61, 357,
     1790949554LL},
};
// home-science-1.json, feed[11], [13], [25]
static const SkyPost SCIENCE[] = {
    {"Erik Strub", "erikstrub.bsky.social",
     "Second paper of Marco (open access) on Tc-99m is online, congrats! Good timing for the weekend.\n\n"
     "www.sciencedirect.com/science/arti...",
     "[link: https://www.sciencedirect.com/science/article/pii/S0168583X26003356 - sciencedirect.com]", 0, 0, 0,
     1790955571LL},
    {"David Blanchflower BSc", "davidbflower.bsky.social",
     "Tonight Mars continues to near the Beehive Cluster. Early on Monday morning joined by the Waning Crescent Moon.",
     NULL, 0, 1, 6, 1790955129LL},
    {"Jason GRIZZLED Bittel", "bittelmethis.bsky.social",
     "Wondering what the big deal is about a few little bugs? Here's why the wine and beer industries are worried "
     "about spotted lanternflies!",
     "[link: Invasive spotted lanternflies seen in New York's wine region - nationalgeographic.com]", 1, 1, 3,
     1790952698LL},
};
static const SkyFeed FEEDS[] = {
    {"Discover", DISCOVER, 3},
    {"Science", SCIENCE, 3},
    {"News", NULL, 0},
};
#define NFEEDS ((int)(sizeof FEEDS / sizeof *FEEDS))
#define POSTS_MAX 8 // rows declared per frame, for the boxes of the last layout

static int light = -1;              // -1: not read yet
static int active, sel[NFEEDS], top; // the app keeps a selection per feed (its store), so does this
static int pointer_x = -1, pointer_y = -1, pressed, pressed_x, pressed_y;

// The cells of the last frame's controls: a click is hit-tested against these, as the desktop's ui_bounds is.
typedef struct {
    int x0, y0, x1, y1;
} CellRect;
static CellRect tab_rect[NFEEDS], row_rect[POSTS_MAX];
static int row_post[POSTS_MAX], row_n;

#define T(name) (light ? name##_light : name)

static void theme_init(void)
{
    if (light < 0) light = getenv("THEME") && !strcmp(getenv("THEME"), "light");
}

static Clay_String str(const char *s) { return (Clay_String){.length = (int32_t)strlen(s), .chars = s}; }

// A cell row does not wrap: the app wraps a body and says wrapMode="none" on its footer, and here both are one row,
// clipped by the card (render.c draws a text command on one row, but Clay would split a wrapped one into several).
static Clay_TextElementConfig nowrap(Clay_TextElementConfig c)
{
    c.wrapMode = CLAY_TEXT_WRAP_NONE;
    return c;
}

// The app's styles are in pixels and a cell is 8x16, so three lengths are re-cut, and only these: the bar's gap and
// padding, the footer's padding, and a card's padding (a cell for the border, which Clay draws inside the box but does
// not inset children by, and a cell for the app's own). Everything else is the generated declaration.
static Clay_ElementDeclaration bar_style(void)
{
    Clay_ElementDeclaration d = T(bar);
    d.layout.padding = (Clay_Padding){.left = CELL_W, .right = CELL_W};
    d.layout.childGap = 2 * CELL_W;
    return d;
}

static Clay_ElementDeclaration footer_style(void)
{
    Clay_ElementDeclaration d = T(footer);
    d.layout.padding = (Clay_Padding){.left = CELL_W, .right = CELL_W};
    return d;
}

static Clay_ElementDeclaration card_style(int on, int hover)
{
    Clay_ElementDeclaration d = on ? T(row_focus) : hover ? T(card_hover) : T(card);
    d.layout.padding = (Clay_Padding){.left = 2 * CELL_W, .right = 2 * CELL_W, .top = CELL_H, .bottom = CELL_H};
    return d;
}

static const SkyFeed *feed(void) { return &FEEDS[active]; }

static void select_feed(int i)
{
    if (i < 0) i = 0;
    if (i >= NFEEDS) i = NFEEDS - 1;
    active = i;
    top = 0;
}

static void move_to(int i)
{
    const int n = feed()->count;
    if (!n) return;
    sel[active] = i < 0 ? 0 : i >= n ? n - 1 : i;
}

// The app's ago(): "now", "5m", "3h", "2d", then a date. The date is not here: no fixture post is that old.
// ponytail: the >7d branch needs a civil-date conversion; add it when a feed carries week-old posts.
static void ago(char *out, size_t n, long long created)
{
    long long s = SKY_NOW - created;
    if (s < 0) s = 0;
    if (s < 60) snprintf(out, n, "now");
    else if (s < 3600) snprintf(out, n, "%lldm", s / 60);
    else if (s < 86400) snprintf(out, n, "%lldh", s / 3600);
    else snprintf(out, n, "%lldd", s / 86400);
}

// The app's compact count: 310, 1200 is "1.2K", 31585 is "32K"; 0 is "0" on a card (the app's `count(n) || 0`).
static void num(char *out, size_t n, int v)
{
    if (v < 1000) snprintf(out, n, "%d", v);
    else if (v < 1000000) {
        if (v % 1000 == 0) snprintf(out, n, "%dK", v / 1000);
        else if (v < 100000) snprintf(out, n, "%.1fK", v / 1000.0);
        else snprintf(out, n, "%.0fK", v / 1000.0);
    } else snprintf(out, n, "%.1fM", v / 1000000.0);
}

static int in_rect(CellRect r, int x, int y) { return x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1; }

static int hit_tab(int x, int y)
{
    for (int i = 0; i < NFEEDS; i++)
        if (in_rect(tab_rect[i], x, y)) return i;
    return -1;
}

static int hit_row(int x, int y)
{
    for (int i = 0; i < row_n; i++)
        if (in_rect(row_rect[i], x, y)) return row_post[i];
    return -1;
}

void sky_input(const TermEvent *ev)
{
    theme_init();
    if (ev->key) {
        const char *k = ev->key;
        const int d = !strcmp(k, "j") || !strcmp(k, "ArrowDown") ? 1
                      : !strcmp(k, "k") || !strcmp(k, "ArrowUp") ? -1
                                                                  : 0;
        if (d) move_to(sel[active] + d);
        else if (!strcmp(k, "Tab")) select_feed(active + 1);
        else if (!strcmp(k, "Shift+Tab")) select_feed(active - 1);
        else if (k[0] >= '1' && k[0] <= '9' && !k[1]) select_feed(k[0] - '1');
        else if (!strcmp(k, "t")) light = !light;
        // enter and escape are the thread screen's (push and pop); this port has the home screen only
    }
    pointer_x = ev->px;
    pointer_y = ev->py;
    if (ev->down) {
        pressed = 1;
        pressed_x = ev->px;
        pressed_y = ev->py;
    }
    if (ev->up) {
        // a press and a release over the same control: the app's onMouseDown, a frame later
        if (pressed && pressed_x == ev->px && pressed_y == ev->py) {
            const int t = hit_tab(ev->px, ev->py);
            const int i = t >= 0 ? -1 : hit_row(ev->px, ev->py);
            if (t >= 0) select_feed(t);
            else if (i >= 0) sel[active] = i;
        }
        pressed = 0;
    }
}

void sky_set_theme(int l) { light = l; }

// One line of a card, cut at its text's first newline: a body is one row in a cell, not the paragraph the app wraps.
static const char *row_text(char *out, size_t n, const char *text)
{
    size_t i = 0;
    for (; i + 1 < n && text[i] && text[i] != '\n'; i++) out[i] = text[i];
    out[i] = 0;
    return out;
}

void sky_declare(void)
{
    theme_init();
    const SkyFeed *f = feed();
    static char label[NFEEDS][32], mid[POSTS_MAX][96], body[POSTS_MAX][256], counts[POSTS_MAX][64], ago_s[16];
    for (int i = 0; i < NFEEDS; i++) snprintf(label[i], sizeof label[i], " %d %s ", i + 1, FEEDS[i].name);

    CLAY(CLAY_ID("Screen"), T(screen)) {
        CLAY(CLAY_ID("Bar"), bar_style()) {
            CLAY_TEXT(CLAY_STRING("sky"), nowrap(T(title_text)));
            for (int i = 0; i < NFEEDS; i++) {
                const int on = i == active, hover = i == hit_tab(pointer_x, pointer_y);
                CLAY(CLAY_IDI("Tab", i), on ? T(tabActive) : hover ? T(tab_hover) : T(tab)) {
                    CLAY_TEXT(str(label[i]), nowrap(on ? T(tabActive_text) : hover ? T(tab_hover_text) : T(tab_text)));
                }
            }
        }
        CLAY(CLAY_ID("List"), T(list)) {
            for (int i = top; i < f->count && i - top < POSTS_MAX; i++) {
                const SkyPost *p = &f->posts[i];
                const int on = i == sel[active], hover = i == hit_row(pointer_x, pointer_y);
                ago(ago_s, sizeof ago_s, p->created);
                snprintf(mid[i], sizeof mid[i], " @%s · %s", p->handle, ago_s);
                char r[16], rp[16], l[16];
                num(r, sizeof r, p->replies), num(rp, sizeof rp, p->reposts), num(l, sizeof l, p->likes);
                snprintf(counts[i], sizeof counts[i], "\xe2\x86\xa9 %s   \xe2\x9f\xb2 %s   \xe2\x99\xa5 %s", r, rp, l);
                CLAY(CLAY_IDI("Row", i), card_style(on, hover)) {
                    // the app's one <text> of spans: adjacent runs, no gap, so they read as one line
                    CLAY(CLAY_IDI("Author", i), {.layout = {.layoutDirection = CLAY_LEFT_TO_RIGHT}}) {
                        CLAY_TEXT(str(p->name[0] ? p->name : p->handle), nowrap(T(name_text)));
                        CLAY_TEXT(str(mid[i]), nowrap(T(meta_text)));
                    }
                    CLAY_TEXT(str(row_text(body[i], sizeof body[i], p->text)), nowrap(T(body_text)));
                    if (p->media) CLAY_TEXT(str(p->media), nowrap(T(muted_text)));
                    CLAY_TEXT(str(counts[i]), nowrap(T(muted_text)));
                }
            }
            if (!f->count) CLAY(CLAY_ID("Empty"), {.layout = {.layoutDirection = CLAY_LEFT_TO_RIGHT}}) {
                CLAY_TEXT(CLAY_STRING("Nothing here yet"), nowrap(T(muted_text)));
            }
        }
        CLAY(CLAY_ID("Footer"), footer_style()) {
            CLAY_TEXT(CLAY_STRING("j/k move \xc2\xb7 enter open \xc2\xb7 tab feed \xc2\xb7 esc back \xc2\xb7 t theme \xc2\xb7 q quit"),
                      nowrap(T(footer_text)));
        }
    }
}

static CellRect to_rect(Clay_BoundingBox b)
{
    CellRect r = {(int)floorf(b.x / CELL_W), (int)floorf(b.y / CELL_H), (int)floorf((b.x + b.width) / CELL_W),
                  (int)floorf((b.y + b.height) / CELL_H)};
    return r;
}

// The boxes of the controls as laid out, and the list scrolling the selection into view as the app's
// scrollChildIntoView does: one pass per row of movement, main.c's loop bounds it.
int sky_settled(void)
{
    const SkyFeed *f = feed();
    for (int i = 0; i < NFEEDS; i++) {
        const Clay_ElementData d = Clay_GetElementData(CLAY_IDI("Tab", i));
        if (d.found) tab_rect[i] = to_rect(d.boundingBox);
    }
    row_n = 0;
    for (int i = top; i < f->count && i - top < POSTS_MAX; i++) {
        const Clay_ElementData d = Clay_GetElementData(CLAY_IDI("Row", i));
        if (!d.found) continue;
        row_rect[row_n] = to_rect(d.boundingBox);
        row_post[row_n] = i;
        row_n++;
    }
    if (!f->count) return 1;

    const Clay_ElementData list = Clay_GetElementData(CLAY_ID("List"));
    const Clay_ElementData row = Clay_GetElementData(CLAY_IDI("Row", sel[active]));
    int next = top;
    if (!row.found) next = sel[active];
    else if (list.found) {
        const CellRect l = to_rect(list.boundingBox), r = to_rect(row.boundingBox);
        if (r.y1 > l.y1) next = top + 1;
        else if (r.y0 < l.y0) next = top - 1;
    }
    if (next < 0) next = 0;
    if (next > f->count - 1) next = f->count - 1;
    if (next == top) return 1;
    top = next;
    return 0;
}

const Page SKY_PAGE = {sky_input, sky_declare, sky_settled};
