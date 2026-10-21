// Clay's render commands into a Cells grid, the way desktop/clay_renderer_thorvg.c draws them into pixels.
//
//   box            -> the cells it covers: floor on the near edge, ceil on the far edge, so any touched cell counts
//   RECTANGLE      -> those cells' background, and their glyph cleared (a fill is opaque on a terminal)
//   BORDER         -> box-drawing characters on the rect's perimeter, one cell thick whatever the pixel width
//   TEXT           -> at (boundingBox.x / CELL_W, boundingBox.y / CELL_H), one row, clipped
//   SCISSOR        -> a stack of cell rects; cells.c clips every put and fill to it
//   IMAGE/CUSTOM   -> not drawn; counted and reported once at exit
//
// What the terminal cannot say is said honestly: a corner radius is a cell's corner (none), a 1px and a 4px border
// are both one cell, and text smaller or larger than a cell is the same cell. Those are the cell mapping, not bugs.
#ifndef RENDER_H
#define RENDER_H

#include "cells.h"
#include "clay.h"

void term_render(Cells *g, Clay_RenderCommandArray *cmds);
/** The commands this renderer ignored, once, on stderr; nothing when it ignored none. */
void term_render_report(void);

#endif
