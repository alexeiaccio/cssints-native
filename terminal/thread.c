// apps/csssky-tui's thread screen in cells (App.tsx's ThreadScreen and Post.tsx, read only): the parents above the post,
// the post itself with its full time and its counts in words, then the replies indented by depth, each row the same
// card as the feed's. The bar says "sky · Thread (esc: back)" and the footer is the app's one line.
//
// The data is the app's recorded thread (apps/csssky/test/fixtures/thread.json) as rowsOf() flattens it: the parent,
// the root (depth 0, the focus card), then the reply tree with a level of indentation every two cells. Nothing is cut
// here: MAX_DEPTH is 3 and the recorded tree is two deep, so the app shows no "Show N more replies" row either.
//
// The focus is terminal/focus.c's: the rows are one vertical group, the root has it when the screen opens, and the
// arrows (or j/k) move it inside the list; the accent border is the focused row, as the app focuses the selected card.
// Escape (or backspace, or h) pops back to the feed, as the app's stack does.
//
// What is not here: fetching (the frame is this fixture, for whatever post opened it, which is what the app's test stub
// answers), an Enter that opens the focused reply's own thread (there is no second recorded thread to show), images and
// the quote box, and wrapping (a body is one clipped row).
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
    const char *name;   // displayName, or the handle when there is none
    const char *handle;
    const char *text;   // the record's first line; NULL when the post has no text
    const char *media;  // model.ts's mediaText, or NULL
    int depth;          // rowsOf()'s depth: the parent and the root 0, a reply 1, a reply to a reply 2
    int focus;          // the thread's own post: no time in the author line, a full time and the counts in words
    int replies, reposts, quotes, likes;
    long long created;
} ThreadRow;

// thread.json: the parent, the root, then its replies (depth 1, and one depth 2), in rowsOf()'s order
static const ThreadRow ROWS[] = {
    {"Mina Kimes", "minakimes.bsky.social",
     "Talked to @wired.com about a bunch of things, including: r/bald, Bluesky, Elon ruining twitter, why I live the "
     "inbox zero life, LLMs, and more.",
     "[link: Want to Get Off Your Phone? Mina Kimes Suggests Having a Baby - wired.com]", 0, 0, 110, 127, 0, 1873,
     1789056210LL},
    {"Bluesky", "bsky.app", "Thanks for being with us here on Bluesky, the official app of sports\u2122\ufe0f", NULL, 0, 1,
     9, 16, 2, 326, 1789059569LL},
    {"jlp2024.bsky.social", "jlp2024.bsky.social",
     "Unfortunately you ban and flag acco7nts in accurately. But,  yeah,  you're better than Twitter.... incredible "
     "achievement.",
     NULL, 1, 0, 0, 0, 0, 0, 1789065437LL},
    {"Davide Aversa \U0001f383", "davideaversa.it", "\U0001f3d0\U0001f3d0\U0001f3d0\U0001f3d0", NULL, 1, 0, 0, 0, 0, 0,
     1789073098LL},
    {"Katie Korth", "katekor.bsky.social", "*men's sports", NULL, 1, 0, 0, 0, 0, 0, 1789073379LL},
    {"rmar124.bsky.social", "rmar124.bsky.social", "And the official app of echo chambers?", NULL, 1, 0, 0, 0, 0, 0,
     1789950717LL},
    {"Mdubs949", "mdubs949.bsky.social",
     "I like this as an aspirational statement, but it's a shame that so many professional and college teams and "
     "leagues post content everywhere else but here.",
     NULL, 1, 0, 1, 0, 0, 4, 1789060220LL},
    {"Ryan", "burnercardinals.bsky.social",
     "The complete lack of beat writers who have moved over to Bsky also makes it a necessity to keep my X going.",
     NULL, 2, 0, 4, 0, 0, 1, 1789060666LL},
    {"Juanita", "juanita2024.bsky.social", "Thanks for providing a forum where I can express my opinions openly.", NULL,
     1, 0, 0, 0, 0, 0, 1789077618LL},
    {"Mina Kimes", "minakimes.bsky.social", NULL, "[link: Jaxon Smith-njigba Jsn - static.klipy.com]", 1, 0, 0, 0, 0,
     226, 1789059860LL},
};
#define NROWS ((int)(sizeof ROWS / sizeof *ROWS))
#define ROOT 1

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

static Clay_ElementDeclaration card_style(int on, int hover)
{
    Clay_ElementDeclaration d = on ? T(row_focus) : hover ? T(card_hover) : T(card);
    d.layout.padding = (Clay_Padding){.left = 2 * CELL_W, .right = 2 * CELL_W, .top = CELL_H, .bottom = CELL_H};
    return d;
}

// A row of the tree, indented by its depth: the app shifts the whole box (marginLeft), a cell keeps the card full
// width and indents its text, because a box shifted a cell or two would leave the page's background showing beside it.
static Clay_ElementDeclaration card_style_depth(int on, int hover, int depth, int cells)
{
    Clay_ElementDeclaration d = card_style(on, hover);
    d.layout.padding.left = (2 + (depth > 6 ? 6 : depth) * 2) * CELL_W;
    // a card's height is its lines, fixed: a FIT card that overflows the list would be shaved to the little room left
    d.layout.sizing.height = CLAY_SIZING_FIXED(cells * CELL_H);
    return d;
}

void thread_reset(void)
{
    FocusStop stops[NROWS];
    for (int i = 0; i < NROWS; i++) {
        snprintf(row_id[i], sizeof row_id[i], "row:%d", i);
        stops[i] = (FocusStop){row_id[i], "rows", 0, 0};
    }
    static const FocusGroup groups[] = {{"rows", FOCUS_VERTICAL, 0, 0, 1, NULL}};
    // no change callback: the focused row is the selection, and the scroll follows it in settled()
    focus_init(&foc, stops, NROWS, groups, 1, NULL, NULL);
    top = 0;
    focus_set(&foc, row_id[ROOT]);
}

static int focused_row(void)
{
    int i;
    const char *id = focus_id(&foc);
    return id && sscanf(id, "row:%d", &i) == 1 ? i : -1;
}

static int hit_row(int x, int y)
{
    for (int i = 0; i < rect_n; i++)
        if (rect_has(row_rect[i], x, y)) return rect_row[i];
    return -1;
}

void thread_input(const TermEvent *ev)
{
    if (ev->key) {
        const char *k = ev->key;
        if (!strcmp(k, "j") || !strcmp(k, "k"))
            focus_key(&foc, !strcmp(k, "j") ? "ArrowDown" : "ArrowUp");
        else if (!strcmp(k, "ArrowDown") || !strcmp(k, "ArrowUp") || !strcmp(k, "ArrowLeft") ||
                 !strcmp(k, "ArrowRight") || !strcmp(k, "Home") || !strcmp(k, "End"))
            focus_key(&foc, k);
        else if (!strcmp(k, "Escape") || !strcmp(k, "Backspace") || !strcmp(k, "h"))
            shell_pop();
        // enter opens a reply's own thread in the app; there is one recorded thread here, so it does nothing
    }
    pointer_x = ev->px;
    pointer_y = ev->py;
    if (ev->down) {
        pressed = 1;
        pressed_x = ev->px;
        pressed_y = ev->py;
    }
    if (ev->up) {
        if (pressed && pressed_x == ev->px && pressed_y == ev->py) {
            const int i = hit_row(ev->px, ev->py);
            if (i >= 0) focus_set(&foc, row_id[i]);
        }
        pressed = 0;
    }
}

void thread_declare(void)
{
    static char mid[NROWS][96], body[NROWS][320], counts[NROWS][128], ago_s[16], full[48];
    for (int i = 0; i < NROWS; i++) {
        const ThreadRow *r = &ROWS[i];
        sky_ago(ago_s, sizeof ago_s, r->created);
        if (r->focus) snprintf(mid[i], sizeof mid[i], " @%s", r->handle);
        else snprintf(mid[i], sizeof mid[i], " @%s \xc2\xb7 %s", r->handle, ago_s);
        if (r->text) {
            size_t n = 0;
            for (; n + 1 < sizeof body[i] && r->text[n] && r->text[n] != '\n'; n++) body[i][n] = r->text[n];
            body[i][n] = 0;
        } else body[i][0] = 0;
        if (r->focus) {
            char a[16], b[16], c[16], d[16];
            sky_num(a, sizeof a, r->replies), sky_num(b, sizeof b, r->reposts);
            sky_num(c, sizeof c, r->quotes), sky_num(d, sizeof d, r->likes);
            snprintf(counts[i], sizeof counts[i], "%s %s   %s %s   %s %s   %s %s", a,
                     r->replies == 1 ? "reply" : "replies", b, r->reposts == 1 ? "repost" : "reposts", c,
                     r->quotes == 1 ? "quote" : "quotes", d, r->likes == 1 ? "like" : "likes");
        } else {
            char a[16], b[16], c[16];
            sky_num(a, sizeof a, r->replies), sky_num(b, sizeof b, r->reposts), sky_num(c, sizeof c, r->likes);
            snprintf(counts[i], sizeof counts[i], "\xe2\x86\xa9 %s   \xe2\x9f\xb2 %s   \xe2\x99\xa5 %s", a, b, c);
        }
        if (r->focus) sky_full_time(full, sizeof full, r->created);
    }

    CLAY(CLAY_ID("Screen"), T(screen)) {
        CLAY(CLAY_ID("Bar"), bar_style()) {
            CLAY_TEXT(CLAY_STRING("sky"), nowrap(T(title_text)));
            CLAY_TEXT(CLAY_STRING(" \xc2\xb7 Thread (esc: back)"), nowrap(T(meta_text)));
        }
        CLAY(CLAY_ID("List"), T(list)) {
            for (int i = top; i < NROWS; i++) {
                const ThreadRow *r = &ROWS[i];
                const int on = focus_is(&foc, row_id[i]), hover = i == hit_row(pointer_x, pointer_y);
                {
                    const int lines = 4 + (r->text ? 1 : 0) + (r->media ? 1 : 0) + (r->focus ? 1 : 0);
                    CLAY(CLAY_IDI("Row", i), card_style_depth(on, hover, r->depth, lines)) {
                        CLAY(CLAY_IDI("Author", i), {.layout = {.layoutDirection = CLAY_LEFT_TO_RIGHT}}) {
                            CLAY_TEXT(str(r->name), nowrap(T(name_text)));
                            CLAY_TEXT(str(mid[i]), nowrap(T(meta_text)));
                        }
                        if (r->text) CLAY_TEXT(str(body[i]), nowrap(T(body_text)));
                        if (r->media) CLAY_TEXT(str(r->media), nowrap(T(muted_text)));
                        if (r->focus) {
                            CLAY_TEXT(str(full), nowrap(T(muted_text)));
                            CLAY_TEXT(str(counts[i]), nowrap(T(muted_text)));
                        } else {
                            CLAY_TEXT(str(counts[i]), nowrap(T(muted_text)));
                        }
                    }
                }
            }
        }
        CLAY(CLAY_ID("Footer"), footer_style()) {
            CLAY_TEXT(CLAY_STRING("j/k move \xc2\xb7 enter open \xc2\xb7 tab feed \xc2\xb7 esc back \xc2\xb7 t theme \xc2\xb7 q quit"),
                      nowrap(T(footer_text)));
        }
    }
}

int thread_settled(void)
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
    return scroll_into(CLAY_ID("List"), CLAY_IDI("Row", sel), sel < 0 ? top : sel, NROWS, &top);
}

const Page THREAD_PAGE = {thread_input, thread_declare, thread_settled, thread_reset};
