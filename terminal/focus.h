// Keyboard focus for a cell page: the terminal's counterpart of focus/src/focus.ts, cut to what a page in C needs.
//
// The rules ported (not the TS API): stops in document order, Tab/Shift+Tab between them with the focus released at
// either end, a group as one Tab stop with roving focus inside it (the arrows, Home/End), and focus(id) that refuses a
// disabled stop. A group says whether its arrows wrap and whether they may leave it at an edge.
//
// What is not here: register/unregister (a page's stops are a static array, rebuilt when its rows change), the
// restore stack (the terminal's screen stack is terminal/shell.c) and tabIndex -1 beyond "not a Tab stop".
#ifndef FOCUS_H
#define FOCUS_H

#define FOCUS_MAX_STOPS 32
#define FOCUS_MAX_GROUPS 8

typedef enum {
    FOCUS_HORIZONTAL, // a bar of tabs: Left/Right
    FOCUS_VERTICAL,   // a list: Up/Down
    FOCUS_BOTH,       // either
} FocusAxis;

typedef struct {
    const char *id;      // the page's name for the stop; borrowed, the page keeps it alive
    const char *group;   // NULL: a Tab stop of its own
    unsigned char disabled; // focus() refuses it, Tab and the arrows skip it (aria-disabled)
    signed char tab_index;  // 0: a Tab stop; < 0: reachable by focus() and the arrows only
} FocusStop;

typedef struct {
    const char *id;
    FocusAxis axis;
    unsigned char wrap;   // the arrows wrap inside the group
    unsigned char leave;  // at an edge with wrap off, an arrow moves to the next/previous stop
    unsigned char memory; // Tab back into the group lands on the member focused last
    const char *entry;    // where Tab lands with no memory; NULL: the first member
} FocusGroup;

typedef struct {
    FocusStop stops[FOCUS_MAX_STOPS];
    int n;
    FocusGroup groups[FOCUS_MAX_GROUPS];
    int ngroups;
    const char *memory[FOCUS_MAX_GROUPS];
    const char *current; // NULL: no stop has focus (released, or not set yet)
    void (*on_change)(const char *id, void *ud);
    void *ud;
} Focus;

/** Copies the stops and groups (the ids are borrowed) and clears the focus and the memory. */
void focus_init(Focus *f, const FocusStop *stops, int n, const FocusGroup *groups, int ngroups,
                void (*on_change)(const char *id, void *ud), void *ud);

/** Forgets the focus and the groups' memory, keeping the stops: a screen entered again. */
void focus_reset(Focus *f);

const char *focus_id(const Focus *f);
/** The focused stop's index in the stops array, -1 when none has focus. */
int focus_slot(const Focus *f);
int focus_is(const Focus *f, const char *id);
/** 1 when the stop exists and is not disabled; 0 otherwise, and the focus does not move. */
int focus_set(Focus *f, const char *id);
/** Tab, Shift+Tab, an arrow or Home/End: 1 when the key was used, 0 when it was not (a release, or not a group key). */
int focus_key(Focus *f, const char *key);

#endif
