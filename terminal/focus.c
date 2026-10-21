// The focus layer's rules, with no renderer: see focus.h for what is ported and what is not.
#include <string.h>

#include "focus.h"

// A Tab stop as Tab walks it: a plain stop, or a group (its target is the member Tab lands on).
typedef struct {
    int at;            // the stop's index in f->stops (a group's first member)
    const char *group; // NULL for a plain stop
    const char *target;
} TabStop;

static int navigable(const FocusStop *s) { return !s->disabled && s->tab_index >= 0; }

static int find_stop(const Focus *f, const char *id)
{
    for (int i = 0; i < f->n; i++)
        if (!strcmp(f->stops[i].id, id)) return i;
    return -1;
}

static int find_group(const Focus *f, const char *id)
{
    for (int i = 0; i < f->ngroups; i++)
        if (!strcmp(f->groups[i].id, id)) return i;
    return -1;
}

/** The index of the m-th navigable member of a group, -1 past the end. */
static int member(const Focus *f, const char *group, int m)
{
    for (int i = 0; i < f->n; i++)
        if (f->stops[i].group && !strcmp(f->stops[i].group, group) && navigable(&f->stops[i]) && m-- == 0)
            return i;
    return -1;
}

static int is_member(const Focus *f, const char *group, const char *id)
{
    const int i = find_stop(f, id);
    return i >= 0 && f->stops[i].group && !strcmp(f->stops[i].group, group) && navigable(&f->stops[i]);
}

/** The member a Tab into the group lands on: remembered, else the group's entry, else the first. */
static const char *entry_of(const Focus *f, int gi)
{
    const FocusGroup *g = &f->groups[gi];
    if (g->memory && f->memory[gi] && is_member(f, g->id, f->memory[gi])) return f->memory[gi];
    if (g->entry && is_member(f, g->id, g->entry)) return g->entry;
    const int i = member(f, g->id, 0);
    return i < 0 ? NULL : f->stops[i].id;
}

static void set_focus(Focus *f, const char *id)
{
    if (id == f->current) return;
    const char *prev = f->current;
    f->current = id;
    if (id) {
        const int si = find_stop(f, id);
        const int gi = si >= 0 && f->stops[si].group ? find_group(f, f->stops[si].group) : -1;
        if (gi >= 0) f->memory[gi] = id;
    }
    if (f->on_change) f->on_change(id, f->ud);
    (void)prev;
}

/** The Tab stops in document order; a group appears once, where its first member is. */
static int stop_list(const Focus *f, TabStop *out)
{
    int n = 0;
    for (int i = 0; i < f->n && n < FOCUS_MAX_STOPS; i++) {
        const FocusStop *s = &f->stops[i];
        if (!navigable(s)) continue;
        if (!s->group) {
            out[n++] = (TabStop){i, NULL, s->id};
            continue;
        }
        int seen = 0;
        for (int k = 0; k < n; k++) seen |= out[k].group && !strcmp(out[k].group, s->group);
        if (!seen) out[n++] = (TabStop){i, s->group, entry_of(f, find_group(f, s->group))};
    }
    return n;
}

void focus_init(Focus *f, const FocusStop *stops, int n, const FocusGroup *groups, int ngroups,
                void (*on_change)(const char *id, void *ud), void *ud)
{
    memset(f, 0, sizeof *f);
    if (n > FOCUS_MAX_STOPS) n = FOCUS_MAX_STOPS;
    if (ngroups > FOCUS_MAX_GROUPS) ngroups = FOCUS_MAX_GROUPS;
    memcpy(f->stops, stops, (size_t)n * sizeof *stops);
    memcpy(f->groups, groups, (size_t)ngroups * sizeof *groups);
    f->n = n;
    f->ngroups = ngroups;
    f->on_change = on_change;
    f->ud = ud;
}

void focus_reset(Focus *f)
{
    f->current = NULL;
    memset(f->memory, 0, sizeof f->memory);
}

const char *focus_id(const Focus *f) { return f->current; }

int focus_slot(const Focus *f)
{
    if (!f->current) return -1;
    for (int i = 0; i < f->n; i++)
        if (!strcmp(f->stops[i].id, f->current)) return i;
    return -1;
}

int focus_is(const Focus *f, const char *id) { return id && f->current && !strcmp(f->current, id); }

int focus_set(Focus *f, const char *id)
{
    const int i = find_stop(f, id);
    if (i < 0 || f->stops[i].disabled) return 0;
    set_focus(f, f->stops[i].id);
    return 1;
}

// Tab: the next stop, or the focus released past either end (the desktop hands the key back to the platform there).
static int tab(Focus *f, int back)
{
    TabStop list[FOCUS_MAX_STOPS];
    const int n = stop_list(f, list);
    if (!n) {
        set_focus(f, NULL);
        return 0;
    }
    int next = back ? n - 1 : 0;
    if (f->current) {
        const int si = find_stop(f, f->current);
        const char *group = si >= 0 ? f->stops[si].group : NULL;
        int here = -1;
        for (int i = 0; i < n; i++)
            if (group ? (list[i].group && !strcmp(list[i].group, group)) : !strcmp(list[i].target, f->current)) {
                here = i;
                break;
            }
        if (here >= 0) {
            next = here + (back ? -1 : 1);
        } else {
            // the focus sits on a stop that is not a Tab stop (tab_index < 0): the next stop by position
            next = back ? -1 : n;
            for (int i = 0; i < n; i++)
                if (si >= 0 && (back ? list[i].at < si : list[i].at > si)) {
                    next = i;
                    break;
                }
        }
    }
    if (next < 0 || next >= n) {
        set_focus(f, NULL);
        return 0;
    }
    set_focus(f, list[next].target);
    return 1;
}

// An arrow at a group's edge with leave: the next/previous Tab stop, wrapping around the whole page.
static void leave(Focus *f, const char *group, int forward)
{
    TabStop list[FOCUS_MAX_STOPS];
    const int n = stop_list(f, list);
    int here = -1;
    for (int i = 0; i < n; i++)
        if (list[i].group && !strcmp(list[i].group, group)) here = i;
    if (here < 0 || n < 2) return;
    const char *id = list[(here + (forward ? 1 : n - 1)) % n].target;
    if (id) set_focus(f, id);
}

static int move(Focus *f, const char *key)
{
    if (!f->current) return 0;
    const int si = find_stop(f, f->current);
    if (si < 0 || !f->stops[si].group) return 0;
    const int gi = find_group(f, f->stops[si].group);
    if (gi < 0) return 0;
    const FocusGroup *g = &f->groups[gi];

    const int horizontal = !strcmp(key, "ArrowLeft") || !strcmp(key, "ArrowRight");
    const int vertical = !strcmp(key, "ArrowUp") || !strcmp(key, "ArrowDown");
    const int first = !strcmp(key, "Home"), last = !strcmp(key, "End");
    const int owned = first || last || (horizontal && g->axis != FOCUS_VERTICAL) ||
                      (vertical && g->axis != FOCUS_HORIZONTAL);
    if (!owned) return 0;

    int count = 0, pos = -1;
    for (int i = 0; i < f->n; i++)
        if (f->stops[i].group && !strcmp(f->stops[i].group, g->id) && navigable(&f->stops[i])) {
            if (i == si) pos = count;
            count++;
        }
    if (pos < 0 || count == 0) return 0;

    int next = pos;
    if (first) next = 0;
    else if (last) next = count - 1;
    else {
        const int forward = !strcmp(key, "ArrowRight") || !strcmp(key, "ArrowDown");
        next = pos + (forward ? 1 : -1);
        if (next < 0 || next >= count) {
            if (g->wrap) next = forward ? 0 : count - 1;
            else if (g->leave) return leave(f, g->id, forward), 1;
            else return 1; // the group's edge: the key is used, nothing moves
        }
    }
    const int mi = member(f, g->id, next);
    if (mi >= 0) set_focus(f, f->stops[mi].id);
    return 1;
}

int focus_key(Focus *f, const char *key)
{
    if (!key) return 0;
    if (!strcmp(key, "Tab")) return tab(f, 0);
    if (!strcmp(key, "Shift+Tab")) return tab(f, 1);
    return move(f, key);
}
