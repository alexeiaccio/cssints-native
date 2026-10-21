// What a page gets each frame: one key (the names the desktop's focus manager uses) or the pointer, in cells.
//
// It is the seam the backends meet at: termbox2's key and mouse events (terminal/tb2.c) and the headless --keys/--click
// path (main.c) both arrive here, so a page cannot tell them apart.
#ifndef INPUT_H
#define INPUT_H

typedef struct {
    const char *key; // one key name ("ArrowDown", "Tab", "Shift+Tab", "Enter", "Space", "t", "1"), or NULL
    int px, py;      // the pointer's cell; -1 when the terminal has no pointer
    int down, up;    // the button's edges this frame (a press, a release)
} TermEvent;

#endif
