// The pages a backend can draw, and the seam main.c drives: input, then a frame, then (once more) a frame if the
// layout itself asked to move something, as a list scrolling the selection into view does.
#ifndef PAGE_H
#define PAGE_H

#include "cells.h"
#include "input.h"

typedef struct {
    /** The key or pointer at the start of a frame, applied before the layout. */
    void (*input)(const TermEvent *ev);
    /** The page's Clay tree. Called inside Clay_BeginLayout/Clay_EndLayout. */
    void (*declare)(void);
    /** After a layout: 1 when it is final, 0 when the page changed something (a scroll) and needs another pass. */
    int (*settled)(void);
    /** A screen entered again: its focus and its scroll. NULL: nothing to do. */
    void (*reset)(void);
} Page;

extern const Page SENSORS_PAGE; // terminal/page.c: the Sensors page plus a list
extern const Page SKY_PAGE;     // terminal/sky.c: apps/csssky-tui's home screen
extern const Page THREAD_PAGE;  // terminal/thread.c: its thread screen
extern const Page PROFILE_PAGE; // terminal/profile.c: apps/csssky's profile screen
extern const Page NOTIFY_PAGE;  // terminal/notify.c: apps/csssky's notifications screen

/** 0 dark, 1 light: the theme the three sky screens draw (main.c sets it; `t` flips it in terminal/shell.c). */
extern int sky_light;

void page_set_theme(int light);

#endif
