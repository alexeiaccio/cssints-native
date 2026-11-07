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
// The focus is terminal/focus.c's, not two ints: the tabs are one roving group (Tab is one stop; Left/Right moves it and
// switches the feed, as a tablist does), the cards another (Up/Down inside the list, out at its edges), and the accent
// border on a card is that card having the focus. Tab from the last stop is released by the layer; a terminal has
// nowhere to hand the key, so the page presses it again and wraps.
//
// Keys: j/k or the arrows move, tab/shift-tab between the bar and the list, 1-3 a feed, enter/space opens the thread,
// t the theme, q quits (the host's, terminal/main.c). A click on a tab switches the feed and one on a card opens its
// thread, as the app's onMouseDown does.
//
// What a cell cannot carry, and what is not here: wrapping (a body is one clipped row), bold and underline (the name
// and the link are colours only), the pointer cursor, images (a media line instead, as the app already does), the
// system theme of src/system.ts (it solves roles from the terminal's palette at run time; the port has styles.ts's dark
// and light themes), scrolling by the wheel or by dragging, and hover that follows the mouse without a click (termbox2
// reports no motion events).
#include <stdio.h>
#include <string.h>

#include "focus.h"
#include "format.h"
#include "geom.h"
#include "page.h"
#include "scroll.h"
#include "shell.h"
#include "sky_styles.h"

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

int sky_light;                       // page.h: the theme all three sky screens draw
static int active, sel[NFEEDS], top; // the app keeps a selection per feed (its store), so does this
static int pointer_x = -1, pointer_y = -1, pressed, pressed_x, pressed_y;

static Focus foc;
static char tab_id[NFEEDS][8], post_id[POSTS_MAX][8];
static int built_feed = -1;

// The cells of the last frame's controls: a click is hit-tested against these, as the desktop's ui_bounds is.
static CellRect tab_rect[NFEEDS], row_rect[POSTS_MAX];
static int row_post[POSTS_MAX], row_n;

#define T(name) (sky_light ? name##_light : name)

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

// ---- focus -------------------------------------------------------------------------------------
// The stops are the three tabs (one group, the roving tablist) and the current feed's cards (another: the focused card
// is the selection). A feed with no posts has no card stops, so Tab walks the bar alone.

static const char *post_id_of(int i)
{
    snprintf(post_id[i], sizeof post_id[i], "post:%d", i);
    return post_id[i];
}

// The callback the focus layer runs when the focus moves: a tab is the active feed, a card is that feed's selection.
static void on_focus(const char *id, void *ud)
{
    (void)ud;
    int i;
    if (!id) return;
    if (sscanf(id, "tab:%d", &i) == 1) {
        if (i >= 0 && i < NFEEDS && i != active) {
            active = i;
            top = 0;
        }
    } else if (sscanf(id, "post:%d", &i) == 1) {
        sel[active] = i;
    }
}

static void foc_build(void)
{
    const SkyFeed *f = feed();
    FocusStop stops[NFEEDS + POSTS_MAX];
    int n = 0;
    built_feed = active;
    for (int i = 0; i < NFEEDS; i++) {
        snprintf(tab_id[i], sizeof tab_id[i], "tab:%d", i);
        stops[n++] = (FocusStop){tab_id[i], "bar", 0, 0};
    }
    for (int i = 0; i < f->count && i < POSTS_MAX; i++) stops[n++] = (FocusStop){post_id_of(i), "list", 0, 0};
    const FocusGroup groups[2] = {
        // a tablist: the arrows wrap, and Tab lands on the active tab. No leave: Left/Right must not walk out of it.
        {"bar", FOCUS_HORIZONTAL, 1, 0, 1, tab_id[active]},
        // a feed: the arrows stop at its ends, or step out to the bar (the app's list has the focus itself)
        {"list", FOCUS_VERTICAL, 0, 1, 1, f->count ? post_id_of(sel[active]) : NULL},
    };
    focus_init(&foc, stops, n, groups, 2, on_focus, NULL);
}

// A feed change rebuilt the stops; keep the focus on the same id when the new feed has it (the focused tab does).
static void foc_sync(void)
{
    if (built_feed == active) return;
    const char *keep = focus_id(&foc);
    foc_build();
    if (keep && !focus_set(&foc, keep)) focus_set(&foc, tab_id[active]);
}

void sky_reset(void)
{
    top = 0;
    foc_build();
    focus_set(&foc, post_id_of(sel[active]));
    if (!focus_id(&foc)) focus_set(&foc, tab_id[active]);
}

// ---- input -------------------------------------------------------------------------------------
static int hit_tab(int x, int y)
{
    for (int i = 0; i < NFEEDS; i++)
        if (rect_has(tab_rect[i], x, y)) return i;
    return -1;
}

static int hit_row(int x, int y)
{
    for (int i = 0; i < row_n; i++)
        if (rect_has(row_rect[i], x, y)) return row_post[i];
    return -1;
}

static int focused_post(void)
{
    int i;
    const char *id = focus_id(&foc);
    return id && sscanf(id, "post:%d", &i) == 1 && i >= 0 && i < feed()->count ? i : -1;
}

static void open_post(int i)
{
    if (i < 0 || i >= feed()->count) return;
    focus_set(&foc, post_id_of(i));
    foc_sync();
    shell_push(&THREAD_PAGE);
}

void sky_input(const TermEvent *ev)
{
    if (ev->key) {
        const char *k = ev->key;
        if (!strcmp(k, "Tab") || !strcmp(k, "Shift+Tab")) {
            // the layer releases the focus past either end; the terminal has no platform to hand Tab to, so wrap
            if (!focus_key(&foc, k)) focus_key(&foc, k);
        } else if (!strcmp(k, "j") || !strcmp(k, "k")) {
            focus_key(&foc, !strcmp(k, "j") ? "ArrowDown" : "ArrowUp");
        } else if (!strcmp(k, "ArrowDown") || !strcmp(k, "ArrowUp") || !strcmp(k, "ArrowLeft") ||
                   !strcmp(k, "ArrowRight") || !strcmp(k, "Home") || !strcmp(k, "End")) {
            focus_key(&foc, k);
        } else if (k[0] >= '1' && k[0] <= '9' && !k[1]) {
            const int i = k[0] - '1';
            if (i < NFEEDS) focus_set(&foc, tab_id[i]);
        } else if (!strcmp(k, "n")) {
            // the app's nav (apps/csssky's Shell.tsx) has Home, a profile and Settings, and the feed's bar is the feed's
            // tabs: a notifications screen has no place in either, so the feed reaches it by this key
            shell_push(&NOTIFY_PAGE);
        } else if (!strcmp(k, "Enter") || !strcmp(k, "Space")) {
            open_post(focused_post());
        }
        foc_sync();
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
            if (t >= 0) {
                focus_set(&foc, tab_id[t]);
                foc_sync();
            } else if (i >= 0) {
                open_post(i);
            }
        }
        pressed = 0;
    }
}

// ---- layout ------------------------------------------------------------------------------------
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
                const int on = focus_is(&foc, post_id[i]), hover = i == hit_row(pointer_x, pointer_y);
                sky_ago(ago_s, sizeof ago_s, p->created);
                snprintf(mid[i], sizeof mid[i], " @%s · %s", p->handle, ago_s);
                char r[16], rp[16], l[16];
                sky_num(r, sizeof r, p->replies), sky_num(rp, sizeof rp, p->reposts), sky_num(l, sizeof l, p->likes);
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

// The boxes of the controls as laid out, and the list scrolling the focused card into view.
int sky_settled(void)
{
    const SkyFeed *f = feed();
    for (int i = 0; i < NFEEDS; i++) {
        const Clay_ElementData d = Clay_GetElementData(CLAY_IDI("Tab", i));
        if (d.found) tab_rect[i] = rect_of(d.boundingBox);
    }
    row_n = 0;
    for (int i = top; i < f->count && i - top < POSTS_MAX; i++) {
        const Clay_ElementData d = Clay_GetElementData(CLAY_IDI("Row", i));
        if (!d.found) continue;
        row_rect[row_n] = rect_of(d.boundingBox);
        row_post[row_n] = i;
        row_n++;
    }
    return scroll_into(CLAY_ID("List"), CLAY_IDI("Row", sel[active]), sel[active], f->count, &top);
}

const Page SKY_PAGE = {sky_input, sky_declare, sky_settled, sky_reset};
