// See scroll.h; the boxes are the ones sky.c's own settled() compared, moved out so the thread and the profile screens
// scroll the same way.
#include "scroll.h"

#include "geom.h"

int scroll_into(Clay_ElementId list, Clay_ElementId row, int row_index, int count, int *top)
{
    if (count <= 0) return 1;
    const Clay_ElementData r = Clay_GetElementData(row);
    const Clay_ElementData l = Clay_GetElementData(list);
    int next = *top;
    if (!r.found) next = row_index;
    else if (l.found) {
        const CellRect lb = rect_of(l.boundingBox), rb = rect_of(r.boundingBox);
        if (rb.y1 > lb.y1) next = *top + 1;
        else if (rb.y0 < lb.y0) next = *top - 1;
    }
    if (next < 0) next = 0;
    if (next > count - 1) next = count - 1;
    if (next == *top) return 1;
    *top = next;
    return 0;
}
