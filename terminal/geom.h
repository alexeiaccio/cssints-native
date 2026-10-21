// A control's box in cells: what a click is hit-tested against, from the box Clay laid out for it.
#ifndef GEOM_H
#define GEOM_H

#include <math.h>

#include "cells.h"
#include "clay.h"

typedef struct {
    int x0, y0, x1, y1; // x1/y1 exclusive: a cell is inside when x0 <= x < x1
} CellRect;

static inline CellRect rect_of(Clay_BoundingBox b)
{
    const CellRect r = {(int)floorf(b.x / CELL_W), (int)floorf(b.y / CELL_H), (int)floorf((b.x + b.width) / CELL_W),
                        (int)floorf((b.y + b.height) / CELL_H)};
    return r;
}

static inline int rect_has(CellRect r, int x, int y) { return x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1; }

#endif
