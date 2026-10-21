// The cell layer and the command mapping, checked without a terminal: the smallest thing that fails when clipping,
// the box characters, UTF-8, SGR merging or the scissor stack break. `sh terminal/build.sh && terminal/test-cells`.
#define _POSIX_C_SOURCE 200809L
#include <assert.h>
#include <stdio.h>
#include <string.h>

#include "cells.h"
#include "render.h"

static int count(const char *haystack, const char *needle)
{
    int n = 0;
    for (const char *p = haystack; (p = strstr(p, needle)); p += strlen(needle)) n++;
    return n;
}

static const char *cell_at(const Cells *g, int x, int y) { return g->cells[y * g->cols + x].bytes; }

static void test_cells(void)
{
    Cells g;
    cells_init(&g, 10, 4);
    const uint8_t page = g.bg;

    // a fill is clipped to the clip rect
    cells_clip(&g, 2, 1, 4, 3);
    cells_fill(&g, 0, 0, 10, 4, cells_color(&g, 1, 2, 3));
    assert(g.cells[0].bg == page && g.cells[1 * g.cols + 1].bg == page);
    assert(g.cells[1 * g.cols + 2].bg == cells_color(&g, 1, 2, 3));

    // text is clipped and decoded a code point a cell
    cells_clear(&g);
    cells_clip(&g, 2, 1, 4, 3);
    cells_put(&g, 1, 1, "hello", -1);
    assert(!strcmp(cell_at(&g, 2, 1), "e") && !strcmp(cell_at(&g, 3, 1), "l"));
    assert(!strcmp(cell_at(&g, 1, 1), "") && !strcmp(cell_at(&g, 4, 1), ""));
    cells_clear(&g);
    cells_put(&g, 0, 0, "a\u00b0\u00b2", -1);
    assert(!strcmp(cell_at(&g, 0, 0), "a") && !strcmp(cell_at(&g, 1, 0), "\u00b0") &&
           !strcmp(cell_at(&g, 2, 0), "\u00b2") && !strcmp(cell_at(&g, 3, 0), ""));
    assert(cells_utf8_count("m/s\u00b2", 5) == 4 && cells_utf8_count("\xe2\x94\x8c", 3) == 1);

    // a box: sides, then the corners where two sides meet
    cells_clear(&g);
    cells_box(&g, 0, 0, 5, 3, cells_color(&g, 9, 9, 9), CELLS_TOP | CELLS_RIGHT | CELLS_BOTTOM | CELLS_LEFT);
    assert(!strcmp(cell_at(&g, 0, 0), "\xe2\x94\x8c") && !strcmp(cell_at(&g, 4, 0), "\xe2\x94\x90"));
    assert(!strcmp(cell_at(&g, 0, 2), "\xe2\x94\x94") && !strcmp(cell_at(&g, 4, 2), "\xe2\x94\x98"));
    assert(!strcmp(cell_at(&g, 2, 0), "\xe2\x94\x80") && !strcmp(cell_at(&g, 0, 1), "\xe2\x94\x82"));
    assert(!strcmp(cell_at(&g, 2, 1), "")); // the inside stays empty
    // one side only: no corners
    cells_clear(&g);
    cells_box(&g, 0, 0, 3, 1, 0, CELLS_BOTTOM);
    assert(!strcmp(cell_at(&g, 1, 0), "\xe2\x94\x80"));

    // a dump marks a fill
    cells_free(&g);
    cells_init(&g, 4, 1);
    cells_fill(&g, 1, 0, 2, 1, cells_color(&g, 1, 2, 3));
    cells_put(&g, 0, 0, "a", -1);
    char buf[256] = {0};
    FILE *f = fmemopen(buf, sizeof buf - 1, "w");
    cells_dump(&g, f);
    fclose(f);
    assert(!strncmp(buf, "a..\n", 4));
    assert(strstr(buf, "# colours:"));

    // SGR runs merge: a row of one colour is one sequence, not one a cell
    f = fmemopen(buf, sizeof buf - 1, "w");
    cells_ansi(&g, f);
    fclose(f);
    assert(count(buf, "\x1b[48;2;1;2;3m") == 1 && count(buf, "\x1b[38;2;") == 1);
    cells_free(&g);
}

static void test_render(void)
{
    Cells g;
    cells_init(&g, 10, 4);
    Clay_RenderCommand cmds[6] = {0};
    cmds[0].commandType = CLAY_RENDER_COMMAND_TYPE_RECTANGLE;
    cmds[0].boundingBox = (Clay_BoundingBox){0, 0, 8, 16};
    cmds[0].renderData.rectangle.backgroundColor = (Clay_Color){9, 9, 9, 255};
    cmds[1].commandType = CLAY_RENDER_COMMAND_TYPE_BORDER;
    cmds[1].boundingBox = (Clay_BoundingBox){16, 0, 32, 32};
    cmds[1].renderData.border.color = (Clay_Color){7, 7, 7, 255};
    cmds[1].renderData.border.width = (Clay_BorderWidth){1, 1, 1, 1};
    cmds[2].commandType = CLAY_RENDER_COMMAND_TYPE_TEXT;
    cmds[2].boundingBox = (Clay_BoundingBox){32, 0, 16, 16};
    cmds[2].renderData.text.stringContents = (Clay_StringSlice){.length = 2, .chars = "ab"};
    cmds[2].renderData.text.textColor = (Clay_Color){1, 2, 3, 255};
    cmds[3].commandType = CLAY_RENDER_COMMAND_TYPE_SCISSOR_START;
    cmds[3].boundingBox = (Clay_BoundingBox){0, 0, 16, 16};
    cmds[3].renderData.clip = (Clay_ClipRenderData){.horizontal = true, .vertical = true};
    cmds[4].commandType = CLAY_RENDER_COMMAND_TYPE_TEXT;
    cmds[4].boundingBox = (Clay_BoundingBox){0, 0, 24, 16};
    cmds[4].renderData.text.stringContents = (Clay_StringSlice){.length = 3, .chars = "XYZ"};
    cmds[4].renderData.text.textColor = (Clay_Color){4, 5, 6, 255};
    cmds[5].commandType = CLAY_RENDER_COMMAND_TYPE_SCISSOR_END;
    Clay_RenderCommandArray array = {6, 6, cmds};
    term_render(&g, &array);

    assert(g.cells[0].bg == cells_color(&g, 9, 9, 9) && g.cells[1].bg == g.bg); // the rect is one cell, no more
    assert(!strcmp(cell_at(&g, 2, 0), "\xe2\x94\x8c") && !strcmp(cell_at(&g, 5, 1), "\xe2\x94\x98"));
    assert(!strcmp(cell_at(&g, 4, 0), "a") && !strcmp(cell_at(&g, 5, 0), "b")); // text at x/CELL_W
    assert(!strcmp(cell_at(&g, 0, 0), "X") && !strcmp(cell_at(&g, 1, 0), "Y"));   // inside the scissor
    assert(!strcmp(cell_at(&g, 2, 0), "\xe2\x94\x8c"));                         // past it: the box row, intact
    assert(g.cells[0 * g.cols + 0].fg == cells_color(&g, 4, 5, 6));             // the text colour, not the default
    cells_free(&g);
}

int main(void)
{
    test_cells();
    test_render();
    puts("terminal cells: ok");
    return 0;
}
