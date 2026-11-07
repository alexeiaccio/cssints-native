// apps/csssky's notifications screen in cells: the header row the app's screens share, then one card per notification —
// the actor, the verb, the post's snippet where the app shows one, and the time — with the accent border on the row
// that has the focus, on the page's own scroll as terminal/thread.c and terminal/profile.c do.
//
// The data is hand-carried, and this is the one screen of the shell that is: the app has no notifications screen, model
// or fixture (apps/csssky/src has no notifications/, its router has no route, and apps/csssky/test/fixtures has no
// answer — the only notifications in it are a recorded post *about* the notifications redesign). So the rows are five
// notifications built here, the app's five kinds: an actor and a post out of the recorded fixtures (home-discover-1,
// home-science-1, thread.json), the wording the app uses for each verb, and, for the time, that post's own createdAt
// through the app's ago() — so a frame is the same today as the recording. The follow has no post (the app shows no
// snippet for one), so Enter on it opens nothing.
//
// The focus is terminal/focus.c's, and the rows are plain stops in document order: Tab and Shift+Tab walk them one by
// one (wrapping at either end, since a terminal has nowhere to hand Tab to), and the arrows do the roving the app's
// list does — the ring moves a row without leaving the list. Escape (or backspace, or h) pops back to where the screen
// was opened from, Enter opens the notification's post as the thread, and a click focuses a card and opens it.
//
// What is not here: a fetch of the real notifications (listNotifications: no fixture was recorded), unread counts and
// their badge, the "All / Mentions" grouping, the actor's avatar (the app draws one; a cell has a glyph), images in the
// snippet, and grouping several actors under one post ("A, B and 3 others liked your post").
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
    const char *glyph;   // the kind's mark, the feed's own glyphs where it has one (a like is a heart)
    const char *actor;   // the actor's displayName (a handle here is the name too when the fixture has no name)
    const char *verb;    // the app's wording: "liked your post", "reposted", "followed you", ...
    const char *snippet; // the post's first line; NULL for a follow, whose notification has no post
    long long created;   // the time: the post's createdAt in the recorded fixtures (a follow has no post, so the actor's)
} NotifyRow;

// newest first, by that time. thread.json's root and its reply, home-discover-1's [20] and [23], home-science-1's [11];
// Mina Kimes has no post here, so the follow's time is her own recorded post's (thread.json's parent)
static const NotifyRow ROWS[] = {
    {"\xe2\x9c\xa6", "Erik Strub", "mentioned you",
     "Second paper of Marco (open access) on Tc-99m is online, congrats! Good timing for the weekend.", 1790955571LL},
    {"\xe2\x9f\xb2", "Titania", "reposted", "The Witch's Cat (1955) by Hilda Boswell", 1790953138LL},
    {"\xe2\x99\xa5", "Michael Warburton", "liked your post", "Ren\u00e9 Magritte at work in his living room in 1964",
     1790948585LL},
    {"\xe2\x86\xa9", "jlp2024.bsky.social", "replied",
     "Unfortunately you ban and flag acco7nts in accurately. But, yeah, you're better than Twitter.... incredible "
     "achievement.",
     1789065437LL},
    {"+", "Mina Kimes", "followed you", NULL, 1789056210LL},
};
#define NROWS ((int)(sizeof ROWS / sizeof *ROWS))

static Focus foc;
static int top;
static char row_id[NROWS][10];
static CellRect row_rect[NROWS];
static int rect_row[NROWS], rect_n;
static int pointer_x = -1, pointer_y = -1, pressed, pressed_x, pressed_y;

#define T(name) (sky_light ? name##_light : name)

static Clay_String str(const char *s) { return (Clay_String){.length = (int32_t)strlen(s), .chars = s}; }

static Clay_TextElementConfig nowrap(Clay_TextElementConfig c)
{
    c.wrapMode = CLAY_TEXT_WRAP_NONE;
    return c;
}

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

// The app's Header: the screen's title, one row, inside the column's gutter.
static Clay_ElementDeclaration header_style(void)
{
    Clay_ElementDeclaration d = {0};
    d.layout.layoutDirection = CLAY_LEFT_TO_RIGHT;
    d.layout.sizing.width = CLAY_SIZING_GROW(0);
    d.layout.padding = (Clay_Padding){.left = 2 * CELL_W, .right = 2 * CELL_W};
    return d;
}

static Clay_ElementDeclaration card_style(int on, int hover, int cells)
{
    Clay_ElementDeclaration d = on ? T(row_focus) : hover ? T(card_hover) : T(card);
    // the focused row is the app's selected row: the accent border *and* the next panel tone, because a border colour
    // alone is the only difference a cell grid would not show in a plain dump
    if (on) d.backgroundColor = T(card_hover).backgroundColor;
    d.layout.padding = (Clay_Padding){.left = 2 * CELL_W, .right = 2 * CELL_W, .top = CELL_H, .bottom = CELL_H};
    // its lines, fixed: a FIT card that overflows the list would be shaved to the little room left
    d.layout.sizing.height = CLAY_SIZING_FIXED(cells * CELL_H);
    return d;
}

// A card's cells: its text rows and the two of the padding around them (a border is drawn inside the box).
static int lines(const NotifyRow *r) { return 3 + (r->snippet ? 1 : 0); }

// ---- focus -------------------------------------------------------------------------------------
void notify_reset(void)
{
    FocusStop stops[NROWS];
    for (int i = 0; i < NROWS; i++) {
        snprintf(row_id[i], sizeof row_id[i], "row:%d", i);
        stops[i] = (FocusStop){row_id[i], NULL, 0, 0}; // plain stops: Tab is the document's order
    }
    focus_init(&foc, stops, NROWS, NULL, 0, NULL, NULL);
    top = 0;
    focus_set(&foc, row_id[0]);
}

static int focused_row(void)
{
    int i;
    const char *id = focus_id(&foc);
    return id && sscanf(id, "row:%d", &i) == 1 && i >= 0 && i < NROWS ? i : -1;
}

// The arrows' roving: the ring moves a row and stays inside the list at either end (the list does not wrap).
static void step(int forward)
{
    const int i = focused_row();
    const int j = i < 0 ? 0 : i + (forward ? 1 : -1);
    if (j >= 0 && j < NROWS) focus_set(&foc, row_id[j]);
}

static int hit_row(int x, int y)
{
    for (int i = 0; i < rect_n; i++)
        if (rect_has(row_rect[i], x, y)) return rect_row[i];
    return -1;
}

static void open_row(int i)
{
    if (i < 0 || i >= NROWS || !ROWS[i].snippet) return; // a follow has no post to open
    focus_set(&foc, row_id[i]);
    shell_push(&THREAD_PAGE);
}

void notify_input(const TermEvent *ev)
{
    if (ev->key) {
        const char *k = ev->key;
        if (!strcmp(k, "Tab") || !strcmp(k, "Shift+Tab")) {
            // the layer releases the focus past either end; the terminal has no platform to hand Tab to, so wrap
            if (!focus_key(&foc, k)) focus_key(&foc, k);
        } else if (!strcmp(k, "j") || !strcmp(k, "k")) {
            step(!strcmp(k, "j"));
        } else if (!strcmp(k, "ArrowDown") || !strcmp(k, "ArrowUp")) {
            step(!strcmp(k, "ArrowDown"));
        } else if (!strcmp(k, "Home")) {
            focus_set(&foc, row_id[0]);
        } else if (!strcmp(k, "End")) {
            focus_set(&foc, row_id[NROWS - 1]);
        } else if (!strcmp(k, "Enter") || !strcmp(k, "Space")) {
            open_row(focused_row());
        } else if (!strcmp(k, "Escape") || !strcmp(k, "Backspace") || !strcmp(k, "h")) {
            shell_pop();
        }
    }
    pointer_x = ev->px;
    pointer_y = ev->py;
    if (ev->down) {
        pressed = 1;
        pressed_x = ev->px;
        pressed_y = ev->py;
    }
    if (ev->up) {
        // a press and a release over the same card: focus it, and open its post if it has one
        if (pressed && pressed_x == ev->px && pressed_y == ev->py) {
            const int i = hit_row(ev->px, ev->py);
            if (i >= 0) {
                focus_set(&foc, row_id[i]);
                open_row(i);
            }
        }
        pressed = 0;
    }
}

// ---- layout ------------------------------------------------------------------------------------
void notify_declare(void)
{
    static char line[NROWS][128], when[NROWS][16];
    for (int i = 0; i < NROWS; i++) {
        const NotifyRow *r = &ROWS[i];
        char ago[12];
        sky_ago(ago, sizeof ago, r->created);
        snprintf(when[i], sizeof when[i], " \xc2\xb7 %s", ago);
        snprintf(line[i], sizeof line[i], "%s %s %s", r->glyph, r->actor, r->verb);
    }

    CLAY(CLAY_ID("Screen"), T(screen)) {
        CLAY(CLAY_ID("Bar"), bar_style()) {
            CLAY_TEXT(CLAY_STRING("sky"), nowrap(T(title_text)));
            CLAY_TEXT(CLAY_STRING(" \xc2\xb7 Notifications (esc: back)"), nowrap(T(meta_text)));
        }
        CLAY(CLAY_ID("Header"), header_style()) { CLAY_TEXT(CLAY_STRING("Notifications"), nowrap(T(name_text))); }
        CLAY(CLAY_ID("List"), T(list)) {
            for (int i = top; i < NROWS; i++) {
                const NotifyRow *r = &ROWS[i];
                const int on = focus_is(&foc, row_id[i]), hover = i == hit_row(pointer_x, pointer_y);
                CLAY(CLAY_IDI("Row", i), card_style(on, hover, lines(r))) {
                    CLAY(CLAY_IDI("Verb", i), {.layout = {.layoutDirection = CLAY_LEFT_TO_RIGHT}}) {
                        CLAY_TEXT(str(line[i]), nowrap(T(name_text)));
                        CLAY_TEXT(str(when[i]), nowrap(T(meta_text)));
                    }
                    if (r->snippet) CLAY_TEXT(str(r->snippet), nowrap(T(muted_text)));
                }
            }
        }
        CLAY(CLAY_ID("Footer"), footer_style()) {
            CLAY_TEXT(CLAY_STRING("j/k move \xc2\xb7 enter open \xc2\xb7 tab row \xc2\xb7 esc back \xc2\xb7 t theme \xc2\xb7 q quit"),
                      nowrap(T(footer_text)));
        }
    }
}

// The cards' boxes as laid out (a click's hit test) and the list scrolling the focused card into view.
int notify_settled(void)
{
    rect_n = 0;
    for (int i = top; i < NROWS; i++) {
        const Clay_ElementData d = Clay_GetElementData(CLAY_IDI("Row", i));
        if (!d.found) continue;
        row_rect[rect_n] = rect_of(d.boundingBox);
        rect_row[rect_n] = i;
        rect_n++;
    }
    const int sel = focused_row();
    return scroll_into(CLAY_ID("List"), CLAY_IDI("Row", sel < 0 ? top : sel), sel < 0 ? top : sel, NROWS, &top);
}

const Page NOTIFY_PAGE = {notify_input, notify_declare, notify_settled, notify_reset};
