// Clay's measure function for a monospace grid: one cell a UTF-8 code point, one cell a line.
//
// A wide glyph (CJK, most emoji) is two columns in a real terminal but one code point here, so a run with one is a
// cell short and everything after it on that row shifts left. A combining mark is a code point too, and takes a cell
// of its own. Both need a width table (wcwidth and a grapheme walk) before a page can mix scripts.
#include "measure.h"

#include "cells.h"

Clay_Dimensions term_measure_text(Clay_StringSlice text, Clay_TextElementConfig *config, void *user)
{
    (void)config; // a terminal has one font size: the cell
    (void)user;
    return (Clay_Dimensions){.width = (float)(cells_utf8_count(text.chars, text.length) * CELL_W),
                             .height = (float)CELL_H};
}
