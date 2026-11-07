// termbox2 as the input/output backend, behind the same Cells grid the ANSI path writes: one termbox2 cell a Cell,
// truecolour when the terminal says it has it (COLORTERM) and the nearest xterm-256 colour otherwise, and termbox2's
// key and mouse events as the desktop's key names plus a pointer cell.
#ifndef TB2_H
#define TB2_H

#include "cells.h"
#include "input.h"

typedef enum { TB2_COLORS_AUTO = 0, TB2_COLORS_TRUECOLOR, TB2_COLORS_256 } Tb2Colors;
typedef enum {
    TB2_NONE = 0, // nothing to draw
    TB2_EVENT = 1,
    TB2_QUIT = 2,   // the terminal said stop (end of input, an error)
    TB2_RESIZE = 3, // *cols/*rows changed: the grid has to be made again
} Tb2Status;

/** termbox2's alternate screen, raw keys and the mouse; 0 on success, else termbox2's error code. */
int term_tb2_open(int *cols, int *rows, Tb2Colors colors);
void term_tb2_size(int *cols, int *rows);
/** 1 when the grid goes out as 24-bit colour, 0 for the 256-colour fallback. */
int term_tb2_truecolor(void);
/** The grid onto the screen: every cell, then tb_present (termbox2 diffs it against its own front buffer). */
void term_tb2_present(const Cells *g);
Tb2Status term_tb2_poll(TermEvent *ev);
/** The same, waiting at most `ms` for an event (TB2_NONE when none arrived): a host that animates needs a frame tick,
 *  and the key names are this file's whatever the wait. `term_tb2_poll` is this with no timeout. */
Tb2Status term_tb2_poll_ms(TermEvent *ev, int ms);
void term_tb2_close(void);
/** The last open's error, for a caller that has to say why termbox2 did not start. */
const char *term_tb2_error(void);
/** Writes `query` to /dev/tty and reads its answer for at most `ms` (a 15 ms quiet gap ends it sooner; `ms` < 0 waits
 *  with no timeout). The bytes into out (NUL-terminated) and their count; 0 without a terminal or an answer. */
int term_tb2_ask(const char *query, char *out, int cap, int ms);

#endif
