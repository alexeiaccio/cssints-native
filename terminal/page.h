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
} Page;

extern const Page SENSORS_PAGE; // terminal/page.c: the Sensors page plus a list
extern const Page SKY_PAGE;     // terminal/sky.c: apps/csssky-tui's home screen

void page_set_theme(int light);
void sky_set_theme(int light);

#endif
