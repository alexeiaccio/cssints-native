// The focus layer without a renderer: Tab order and the release at either end, a roving group's arrows with and
// without wrap, leaving a group at its edge, memory, Home/End and a disabled stop. The smallest thing that fails when
// the rules break: `cc -I terminal terminal/test_focus.c terminal/focus.c -o test_focus && ./test_focus`.
#include <assert.h>
#include <stdio.h>
#include <string.h>

#include "focus.h"

static const char *last; // the change callback's last id
static int changes;

static void on_change(const char *id, void *ud)
{
    (void)ud;
    last = id;
    changes++;
}

#define TABS 3
static const FocusStop STOPS[] = {
    // a bar: a roving group of three tabs, Tab lands on the first
    {"tab0", "bar", 0, 0},
    {"tab1", "bar", 0, 0},
    {"tab2", "bar", 0, 0},
    // a list: a vertical group of three cards, and one card that is disabled
    {"card0", "list", 0, 0},
    {"card1", "list", 1, 0},
    {"card2", "list", 0, 0},
    // a plain stop, and one only the arrows reach
    {"footer", NULL, 0, 0},
    {"hidden", NULL, 0, -1},
};
#define NSTOPS ((int)(sizeof STOPS / sizeof *STOPS))

static const FocusGroup GROUPS[] = {
    {"bar", FOCUS_HORIZONTAL, 1, 0, 1, NULL},  // wraps, remembers
    {"list", FOCUS_VERTICAL, 0, 1, 1, "card0"}, // no wrap, leaves at its edges
};

static Focus make(void)
{
    Focus f;
    focus_init(&f, STOPS, NSTOPS, GROUPS, 2, on_change, NULL);
    last = NULL;
    changes = 0;
    return f;
}

// Tab order: the bar is one stop, the list another, a disabled card and a tab_index < 0 stop are skipped.
static void test_tab_release(void)
{
    Focus f = make();
    assert(focus_id(&f) == NULL);

    // from nothing, forward: the bar (its entry member), the list, the footer, then released
    assert(focus_key(&f, "Tab") && !strcmp(focus_id(&f), "tab0"));
    assert(focus_key(&f, "Tab") && !strcmp(focus_id(&f), "card0"));
    assert(focus_key(&f, "Tab") && !strcmp(focus_id(&f), "footer"));
    assert(!focus_key(&f, "Tab") && focus_id(&f) == NULL); // past the end: released
    assert(last == NULL);                                 // the callback saw the release too
    assert(changes >= 4);

    // and back: from nothing, back goes to the last stop; from the first, released
    Focus g = make();
    assert(focus_key(&g, "Shift+Tab") && !strcmp(focus_id(&g), "footer"));
    assert(focus_key(&g, "Shift+Tab") && !strcmp(focus_id(&g), "card0"));
    assert(focus_key(&g, "Shift+Tab") && !strcmp(focus_id(&g), "tab0"));
    assert(!focus_key(&g, "Shift+Tab") && focus_id(&g) == NULL);
    // released is a state of its own: the next Tab enters again at the first or the last stop (a page that has
    // nowhere to hand the key wraps by pressing it twice; see the sky page)
    assert(focus_key(&g, "Shift+Tab") && !strcmp(focus_id(&g), "footer"));
}

// A roving group: the arrows move inside it, wrap when the group says so, and leave at an edge when it says that.
static void test_roving(void)
{
    Focus f = make();
    assert(focus_set(&f, "tab0"));
    assert(focus_key(&f, "ArrowRight") && !strcmp(focus_id(&f), "tab1"));
    assert(focus_key(&f, "ArrowRight") && !strcmp(focus_id(&f), "tab2"));
    assert(focus_key(&f, "ArrowRight") && !strcmp(focus_id(&f), "tab0")); // bar wraps
    assert(focus_key(&f, "ArrowLeft") && !strcmp(focus_id(&f), "tab2"));
    assert(focus_key(&f, "End") && !strcmp(focus_id(&f), "tab2"));
    assert(focus_key(&f, "Home") && !strcmp(focus_id(&f), "tab0"));
    // a vertical group does not take Left/Right
    assert(focus_set(&f, "card0"));
    assert(!focus_key(&f, "ArrowRight") && !strcmp(focus_id(&f), "card0"));

    // the list: no wrap, so its last member is its edge, and leave takes the focus out to the next stop
    assert(focus_key(&f, "ArrowDown") && !strcmp(focus_id(&f), "card2")); // card1 is disabled: skipped
    assert(focus_key(&f, "ArrowDown") && !strcmp(focus_id(&f), "footer")); // left the group, not wrapped
    // and back up out of the group's top edge: the previous stop, the bar
    Focus g = make();
    assert(focus_set(&g, "card0"));
    assert(focus_key(&g, "ArrowUp") && !strcmp(focus_id(&g), "tab0"));
}

// A group without wrap or leave holds the focus at its edge, and uses the key there.
static void test_edge_holds(void)
{
    static const FocusStop stops[] = {{"a", "col", 0, 0}, {"b", "col", 0, 0}, {"after", NULL, 0, 0}};
    static const FocusGroup groups[] = {{"col", FOCUS_VERTICAL, 0, 0, 0, NULL}};
    Focus f;
    focus_init(&f, stops, 3, groups, 1, NULL, NULL);
    assert(focus_set(&f, "b"));
    assert(focus_key(&f, "ArrowDown") && !strcmp(focus_id(&f), "b")); // used, stays
    assert(focus_key(&f, "ArrowUp") && !strcmp(focus_id(&f), "a"));
    assert(focus_key(&f, "ArrowUp") && !strcmp(focus_id(&f), "a"));
    // Tab still moves on, after the group
    assert(focus_key(&f, "Tab") && !strcmp(focus_id(&f), "after"));
}

// focus() refuses a disabled stop, and Tab never lands on one.
static void test_disabled(void)
{
    Focus f = make();
    assert(!focus_set(&f, "card1") && focus_id(&f) == NULL);
    assert(focus_set(&f, "card0") && !strcmp(focus_id(&f), "card0"));
    assert(!focus_set(&f, "nope") && !strcmp(focus_id(&f), "card0"));
    assert(focus_key(&f, "ArrowDown") && !strcmp(focus_id(&f), "card2")); // card1 is disabled
}

// Tab back into the group lands on the member focused last; the entry is the fallback.
static void test_memory(void)
{
    Focus f = make();
    assert(focus_set(&f, "tab2"));
    assert(focus_key(&f, "Tab") && !strcmp(focus_id(&f), "card0")); // the list, its entry
    assert(focus_key(&f, "Shift+Tab") && !strcmp(focus_id(&f), "tab2")); // back to the bar's member
    assert(focus_key(&f, "Tab") && !strcmp(focus_id(&f), "card0"));
    assert(focus_key(&f, "ArrowDown") && !strcmp(focus_id(&f), "card2"));
    assert(focus_key(&f, "Shift+Tab") && !strcmp(focus_id(&f), "tab2"));
    assert(focus_key(&f, "Tab") && !strcmp(focus_id(&f), "card2")); // the list's memory
    // a page that changes its rows resets the focus: no memory, the entry again
    focus_reset(&f);
    assert(focus_id(&f) == NULL);
    assert(focus_key(&f, "Tab") && !strcmp(focus_id(&f), "tab0"));
    assert(focus_key(&f, "Tab") && !strcmp(focus_id(&f), "card0"));
}

// A tab_index < 0 stop is not in the Tab order, but focus() and the arrows reach it.
static void test_tab_index(void)
{
    Focus f = make();
    assert(focus_set(&f, "hidden") && !strcmp(focus_id(&f), "hidden"));
    assert(!focus_key(&f, "ArrowDown") && !strcmp(focus_id(&f), "hidden")); // not in a group
    assert(!focus_key(&f, "Tab") && focus_id(&f) == NULL); // nothing after it: released
}

int main(void)
{
    test_tab_release();
    test_roving();
    test_edge_holds();
    test_disabled();
    test_memory();
    test_tab_index();
    puts("focus: Tab order, release, roving groups, edges, memory, disabled ok");
    return 0;
}
