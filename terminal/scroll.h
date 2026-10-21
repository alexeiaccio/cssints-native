// The list scrolling the focused row into view: Clay's boxes for the list and the row, and the page's top row moved one
// row per pass, as apps/csssky-tui's scrollChildIntoView does. main.c runs the layout again until settled() is 1.
#ifndef SCROLL_H
#define SCROLL_H

#include "clay.h"

/**
 * *top so that the row's box is inside the list's: 1 when it already was, 0 when it moved (another layout pass needed).
 * A row that was not laid out this pass (past the viewport) puts the top at its index.
 */
int scroll_into(Clay_ElementId list, Clay_ElementId row, int row_index, int count, int *top);

#endif
