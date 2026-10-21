// The terminal's screen stack: the sky pages push a thread or a profile and Escape pops it, as csssky-tui's
// `stack` does. main.c drives SHELL_PAGE; the pages reach the stack with shell_push/shell_pop.
#ifndef SHELL_H
#define SHELL_H

#include "page.h"

extern const Page SHELL_PAGE;

/** Make `root` the only screen on the stack (main.c's --page). Its reset, if any, is the caller's. */
void shell_reset(const Page *root);
/** A screen on top; its reset runs (a thread scrolled from the top, a profile on its first tab). */
void shell_push(const Page *p);
/** Back: nothing below the bottom screen. */
void shell_pop(void);
/** Reset the top screen (SHELL_PAGE.reset: main.c after --page). */
void shell_reset_top(void);

#endif
