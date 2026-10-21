// apps/csssky's profile screen in cells (apps/csssky/src/screens/Profile.tsx and profile/Header.tsx, read only; the
// csssky-tui app has no profile screen of its own, and this one shares its data layer and model.ts). The bar says
// "sky · @bsky.app", the header is the banner band, the name and handle, the bio's two lines and the counts, then the
// Posts / Replies / Media tabs and the posts of the tab_i, each with the reason line the app draws above it.
//
// The data is the app's recorded fixtures: profile.json (getProfile), and profile-posts, profile-replies and
// profile-media for the three tabs (three posts each of the recorded pages, verbatim; the tab's own page is the one the
// app would fetch). Counts are count()'s: 35,119,957 is "35M". Times are ago() with now pinned to the fixtures' moment,
// so "Pinned" is "Oct 17, 2024" and not a number of days.
//
// The focus is terminal/focus.c's: the tabs are one roving group (Left/Right switches the tab_i, as the app's tablist
// does) and the posts another; Tab and Shift+Tab walk between the two, and Enter opens the focused post's thread. The
// accent border on a card is that card having the focus. Escape pops back to where the profile was opened from.
//
// What is not here: the banner and avatar images (a band of colour and no picture), the bio's link facets (one colour),
// the tabs' sticky header and their bottom border (the active tab_i is the accent pill the tui's own bar uses), the paged
// feed (one recorded page a tab_i, no "Try again", no "Loading…"), and replies/media paging.
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
    const char *reason; // the line above the card: "Pinned", "Reposted by ...", "Replying to @...", or NULL
    const char *name, *handle, *text, *media;
    int replies, reposts, likes;
    long long created;
} ProfPost;

typedef struct {
    const char *label;
    const ProfPost *posts;
    int count;
} ProfTab;

// profile-posts.json: the pinned post, a repost, and a post of the account itself
static const ProfPost POSTS[] = {
    {"Pinned", "Bluesky", "bsky.app",
     "\U0001f44b  Bluesky is an open social network that gives creators independence from platforms, developers the "
     "freedom to build, and users a choice in their experience.",
     NULL, 8648, 9541, 63747, 1729148811LL},
    {"Reposted by bsky.app", "Aster ID", "aster.id",
     "The modern research ecosystem of online tools and communities is controlled by for-profit companies.",
     "[link: Announcing Aster - a home for researchers on the open web - blog.aster.place]", 15, 142, 706, 1790774543LL},
    {NULL, "Bluesky", "bsky.app",
     "Thread numbering is out of beta! Threaded posts are now automatically numbered, to help you follow along.",
     NULL, 114, 396, 2233, 1788538962LL},
};
// profile-replies.json, feed[5], [6], [7]: replies of the account, with the app's reason line
static const ProfPost REPLIES[] = {
    {"Replying to @minakimes.bsky.social", "Bluesky", "bsky.app",
     "Thanks for being with us here on Bluesky, the official app of sports\u2122\ufe0f", NULL, 9, 16, 326, 1789059569LL},
    {"Replying to @bsky.app", "Bluesky", "bsky.app",
     "Thank you for coming to today\u2019s Apple event! You can find these and more Apple products at your nearest "
     "grocery store, farmers\u2019 market, or orchard.",
     "[link: Apple Experts - go.bsky.app]", 4, 4, 220, 1788978464LL},
    {"Replying to @bsky.app", "Bluesky", "bsky.app",
     "@lightlyspicy.bsky.social asks, \"Best way to care for young apple trees?\"", NULL, 4, 7, 198, 1788978419LL},
};
// profile-media.json, feed[0], [6], [12]: posts with an image or a gallery, as mediaText() prints them
static const ProfPost MEDIA[] = {
    {NULL, "Bluesky", "bsky.app",
     "Not to brag, but ... we snagged a couple of passes to today\u2019s Apple event. Stay tuned for our take on all the "
     "latest and greatest Apple products.",
     "[image: An enormous pile of red apples and green apples\u2014sweet, tart, delicious, and coming soon to an Apple "
     "Store near you! Keep your eye on this thread (and maybe put on a sturdy hat) to learn more about today's big "
     "drops.]",
     117, 157, 2342, 1788966007LL},
    {NULL, "Bluesky", "bsky.app", "wait a minute", "[image: two spidermen pointing at each other]", 5, 5, 56,
     1783012911LL},
    {NULL, "Bluesky", "bsky.app", "videos posted on bluesky are now higher resolution! \u2728",
     "[2 images: pixelated potato]", 528, 2020, 21327, 1753742220LL},
};
static const ProfTab TABS[] = {
    {"Posts", POSTS, (int)(sizeof POSTS / sizeof *POSTS)},
    {"Replies", REPLIES, (int)(sizeof REPLIES / sizeof *REPLIES)},
    {"Media", MEDIA, (int)(sizeof MEDIA / sizeof *MEDIA)},
};
#define NTABS ((int)(sizeof TABS / sizeof *TABS))
#define POSTS_MAX 8

// profile.json: getProfile
static const char *const BIO[] = {"official Bluesky account (check username\U0001f446)",
                                  "Bugs, feature requests, feedback: support@bsky.app"};
static const int FOLLOWERS = 35119957, FOLLOWING = 15, POSTS_N = 865;

static int tab_i, top;
static Focus foc;
static char tab_id[NTABS][8], post_id[POSTS_MAX][8];
static int built_tab = -1;
static int pointer_x = -1, pointer_y = -1, pressed, pressed_x, pressed_y;
static CellRect tab_rect[NTABS], post_rect[POSTS_MAX];
static int rect_post[POSTS_MAX], rect_n;

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

// The banner is an image in the app: a band of colour here, two cells tall and a shade off the cards.
static Clay_ElementDeclaration banner_style(void)
{
    Clay_ElementDeclaration d = {0};
    d.layout.sizing.width = CLAY_SIZING_GROW(0);
    d.layout.sizing.height = CLAY_SIZING_FIXED(2 * CELL_H);
    d.backgroundColor = T(tab_hover).backgroundColor;
    return d;
}

// The header's rows are the app's, one cell each: the name, the handle, the bio, the counts. The banner is outside it:
// the app's banner is the full width of the column.
static Clay_ElementDeclaration header_style(void)
{
    Clay_ElementDeclaration d = {0};
    d.layout.layoutDirection = CLAY_TOP_TO_BOTTOM;
    d.layout.sizing.width = CLAY_SIZING_GROW(0);
    d.layout.padding = (Clay_Padding){.left = 2 * CELL_W, .right = 2 * CELL_W};
    return d;
}

static Clay_ElementDeclaration card_style(int on, int hover, int cells)
{
    Clay_ElementDeclaration d = on ? T(row_focus) : hover ? T(card_hover) : T(card);
    d.layout.padding = (Clay_Padding){.left = 2 * CELL_W, .right = 2 * CELL_W, .top = CELL_H, .bottom = CELL_H};
    // its lines, fixed: a FIT card that overflows the list would be shaved to the little room left
    d.layout.sizing.height = CLAY_SIZING_FIXED(cells * CELL_H);
    return d;
}

// ---- focus -------------------------------------------------------------------------------------
static const ProfTab *cur(void) { return &TABS[tab_i]; }

static const char *post_id_of(int i)
{
    snprintf(post_id[i], sizeof post_id[i], "post:%d", i);
    return post_id[i];
}

static void on_focus(const char *id, void *ud)
{
    (void)ud;
    int i;
    if (!id) return;
    if (sscanf(id, "tab:%d", &i) == 1) {
        if (i >= 0 && i < NTABS && i != tab_i) {
            tab_i = i;
            top = 0;
        }
    }
}

static void foc_build(void)
{
    const ProfTab *t = cur();
    FocusStop stops[NTABS + POSTS_MAX];
    int n = 0;
    built_tab = tab_i;
    for (int i = 0; i < NTABS; i++) {
        snprintf(tab_id[i], sizeof tab_id[i], "tab:%d", i);
        stops[n++] = (FocusStop){tab_id[i], "tabs", 0, 0};
    }
    for (int i = 0; i < t->count && i < POSTS_MAX; i++) stops[n++] = (FocusStop){post_id_of(i), "posts", 0, 0};
    const FocusGroup groups[2] = {
        {"tabs", FOCUS_HORIZONTAL, 1, 0, 1, tab_id[tab_i]},
        {"posts", FOCUS_VERTICAL, 0, 1, 1, t->count ? post_id_of(0) : NULL},
    };
    focus_init(&foc, stops, n, groups, 2, on_focus, NULL);
}

static void foc_sync(void)
{
    if (built_tab == tab_i) return;
    const char *keep = focus_id(&foc);
    foc_build();
    if (keep && !focus_set(&foc, keep)) focus_set(&foc, tab_id[tab_i]);
}

void profile_reset(void)
{
    top = 0;
    tab_i = 0;
    foc_build();
    focus_set(&foc, post_id_of(0));
    if (!focus_id(&foc)) focus_set(&foc, tab_id[tab_i]);
}

// ---- input -------------------------------------------------------------------------------------
static int hit_tab(int x, int y)
{
    for (int i = 0; i < NTABS; i++)
        if (rect_has(tab_rect[i], x, y)) return i;
    return -1;
}

static int hit_post(int x, int y)
{
    for (int i = 0; i < rect_n; i++)
        if (rect_has(post_rect[i], x, y)) return rect_post[i];
    return -1;
}

static int focused_post(void)
{
    int i;
    const char *id = focus_id(&foc);
    return id && sscanf(id, "post:%d", &i) == 1 && i >= 0 && i < cur()->count ? i : -1;
}

static void open_post(int i)
{
    if (i < 0 || i >= cur()->count) return;
    focus_set(&foc, post_id_of(i));
    foc_sync();
    shell_push(&THREAD_PAGE);
}

void profile_input(const TermEvent *ev)
{
    if (ev->key) {
        const char *k = ev->key;
        if (!strcmp(k, "Tab") || !strcmp(k, "Shift+Tab")) {
            if (!focus_key(&foc, k)) focus_key(&foc, k); // released at an end: the terminal wraps
        } else if (!strcmp(k, "j") || !strcmp(k, "k")) {
            focus_key(&foc, !strcmp(k, "j") ? "ArrowDown" : "ArrowUp");
        } else if (!strcmp(k, "ArrowDown") || !strcmp(k, "ArrowUp") || !strcmp(k, "ArrowLeft") ||
                   !strcmp(k, "ArrowRight") || !strcmp(k, "Home") || !strcmp(k, "End")) {
            focus_key(&foc, k);
        } else if (!strcmp(k, "Enter") || !strcmp(k, "Space")) {
            open_post(focused_post());
        } else if (!strcmp(k, "Escape") || !strcmp(k, "Backspace") || !strcmp(k, "h")) {
            shell_pop();
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
        if (pressed && pressed_x == ev->px && pressed_y == ev->py) {
            const int t = hit_tab(ev->px, ev->py);
            const int i = t >= 0 ? -1 : hit_post(ev->px, ev->py);
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
void profile_declare(void)
{
    const ProfTab *t = cur();
    static char counts[POSTS_MAX][64], body[POSTS_MAX][320], meta[POSTS_MAX][96], when[POSTS_MAX][16];
    static char followers[16], following[16], posts[16];
    for (int i = 0; i < t->count; i++) {
        const ProfPost *p = &t->posts[i];
        sky_ago(when[i], sizeof when[i], p->created);
        snprintf(meta[i], sizeof meta[i], " @%s \xc2\xb7 %s", p->handle, when[i]);
        size_t n = 0;
        for (; n + 1 < sizeof body[i] && p->text[n] && p->text[n] != '\n'; n++) body[i][n] = p->text[n];
        body[i][n] = 0;
        char r[16], rp[16], l[16];
        sky_num(r, sizeof r, p->replies), sky_num(rp, sizeof rp, p->reposts), sky_num(l, sizeof l, p->likes);
        snprintf(counts[i], sizeof counts[i], "\xe2\x86\xa9 %s   \xe2\x9f\xb2 %s   \xe2\x99\xa5 %s", r, rp, l);
    }
    sky_num(followers, sizeof followers, FOLLOWERS);
    sky_num(following, sizeof following, FOLLOWING);
    sky_num(posts, sizeof posts, POSTS_N);

    CLAY(CLAY_ID("Screen"), T(screen)) {
        CLAY(CLAY_ID("Bar"), bar_style()) {
            CLAY_TEXT(CLAY_STRING("sky"), nowrap(T(title_text)));
            CLAY_TEXT(CLAY_STRING(" \xc2\xb7 @bsky.app"), nowrap(T(meta_text)));
        }
        CLAY(CLAY_ID("Banner"), banner_style()) {}
        CLAY(CLAY_ID("Header"), header_style()) {
            CLAY(CLAY_ID("Name"), {.layout = {.layoutDirection = CLAY_LEFT_TO_RIGHT}}) {
                CLAY_TEXT(CLAY_STRING("Bluesky"), nowrap(T(name_text)));
            }
            CLAY(CLAY_ID("Handle"), {.layout = {.layoutDirection = CLAY_LEFT_TO_RIGHT}}) {
                CLAY_TEXT(CLAY_STRING(" @bsky.app"), nowrap(T(meta_text)));
            }
            for (size_t i = 0; i < sizeof BIO / sizeof *BIO; i++)
                CLAY(CLAY_IDI("Bio", (int32_t)i), {.layout = {.layoutDirection = CLAY_LEFT_TO_RIGHT}}) {
                    CLAY_TEXT(str(BIO[i]), nowrap(T(body_text)));
                }
            CLAY(CLAY_ID("Counts"), {.layout = {.layoutDirection = CLAY_LEFT_TO_RIGHT, .childGap = 3 * CELL_W}}) {
                CLAY(CLAY_ID("Followers"), {.layout = {.layoutDirection = CLAY_LEFT_TO_RIGHT}}) {
                    CLAY_TEXT(str(followers), nowrap(T(name_text)));
                    CLAY_TEXT(CLAY_STRING(" followers"), nowrap(T(meta_text)));
                }
                CLAY(CLAY_ID("Following"), {.layout = {.layoutDirection = CLAY_LEFT_TO_RIGHT}}) {
                    CLAY_TEXT(str(following), nowrap(T(name_text)));
                    CLAY_TEXT(CLAY_STRING(" following"), nowrap(T(meta_text)));
                }
                CLAY(CLAY_ID("PostsCount"), {.layout = {.layoutDirection = CLAY_LEFT_TO_RIGHT}}) {
                    CLAY_TEXT(str(posts), nowrap(T(name_text)));
                    CLAY_TEXT(CLAY_STRING(" posts"), nowrap(T(meta_text)));
                }
            }
        }
        CLAY(CLAY_ID("Tabs"), bar_style()) {
            for (int i = 0; i < NTABS; i++) {
                static char label[NTABS][24];
                snprintf(label[i], sizeof label[i], " %s ", TABS[i].label);
                const int on = i == tab_i, hover = i == hit_tab(pointer_x, pointer_y);
                CLAY(CLAY_IDI("Tab", i), on ? T(tabActive) : hover ? T(tab_hover) : T(tab)) {
                    CLAY_TEXT(str(label[i]), nowrap(on ? T(tabActive_text) : hover ? T(tab_hover_text) : T(tab_text)));
                }
            }
        }
        CLAY(CLAY_ID("List"), T(list)) {
            for (int i = top; i < t->count; i++) {
                const ProfPost *p = &t->posts[i];
                const int on = focus_is(&foc, post_id[i]), hover = i == hit_post(pointer_x, pointer_y);
                if (p->reason) CLAY(CLAY_IDI("Reason", i), {.layout = {.layoutDirection = CLAY_LEFT_TO_RIGHT,
                                                                  .padding = {.left = 2 * CELL_W}}}) {
                    CLAY_TEXT(str(p->reason), nowrap(T(muted_text)));
                }
                const int lines = 5 + (p->media ? 1 : 0);
                CLAY(CLAY_IDI("Row", i), card_style(on, hover, lines)) {
                    CLAY(CLAY_IDI("Author", i), {.layout = {.layoutDirection = CLAY_LEFT_TO_RIGHT}}) {
                        CLAY_TEXT(str(p->name), nowrap(T(name_text)));
                        CLAY_TEXT(str(meta[i]), nowrap(T(meta_text)));
                    }
                    CLAY_TEXT(str(body[i]), nowrap(T(body_text)));
                    if (p->media) CLAY_TEXT(str(p->media), nowrap(T(muted_text)));
                    CLAY_TEXT(str(counts[i]), nowrap(T(muted_text)));
                }
            }
        }
        CLAY(CLAY_ID("Footer"), footer_style()) {
            CLAY_TEXT(CLAY_STRING("j/k move \xc2\xb7 enter open \xc2\xb7 tab feed \xc2\xb7 esc back \xc2\xb7 t theme \xc2\xb7 q quit"),
                      nowrap(T(footer_text)));
        }
    }
}

int profile_settled(void)
{
    for (int i = 0; i < NTABS; i++) {
        const Clay_ElementData d = Clay_GetElementData(CLAY_IDI("Tab", i));
        if (d.found) tab_rect[i] = rect_of(d.boundingBox);
    }
    rect_n = 0;
    for (int i = top; i < cur()->count; i++) {
        const Clay_ElementData d = Clay_GetElementData(CLAY_IDI("Row", i));
        if (!d.found) continue;
        post_rect[rect_n] = rect_of(d.boundingBox);
        rect_post[rect_n] = i;
        rect_n++;
    }
    const int sel = focused_post();
    return scroll_into(CLAY_ID("List"), CLAY_IDI("Row", sel < 0 ? 0 : sel), sel < 0 ? 0 : sel, cur()->count, &top);
}

const Page PROFILE_PAGE = {profile_input, profile_declare, profile_settled, profile_reset};
