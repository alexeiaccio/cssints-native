// A grid of character cells, and the two ways to get it out: ANSI truecolour for a terminal, plain text for tests.
//
// It is the terminal's framebuffer: one Cell per box on the screen, each with up to 4 UTF-8 bytes and a foreground
// and background colour. Colours are palette indices, so a cell is 7 bytes and two cells compare equal by bytes; the
// palette holds the exact RGB Clays hands over, so the ANSI path stays truecolour (38;2 / 48;2).
#ifndef CELLS_H
#define CELLS_H

#include <stdint.h>
#include <stdio.h>

// One cell is 8x16 device pixels: the classic 8x16 VGA cell, and the size of most terminal fonts at 16px. Clay's
// numbers are pixels, so a terminal page's lengths are cells x this. See docs/map.md step 6 for what it costs.
#define CELL_W 8
#define CELL_H 16

#define CELLS_PALETTE 256
#define CELLS_TOP 1
#define CELLS_RIGHT 2
#define CELLS_BOTTOM 4
#define CELLS_LEFT 8

typedef struct {
    char bytes[5]; // one UTF-8 code point (up to 4 bytes) and a NUL; 0 for an empty cell
    uint8_t fg, bg; // indices into Cells.palette
} Cell;

typedef struct {
    uint8_t r, g, b;
} CellRGB;

typedef struct {
    int cols, rows;
    Cell *cells;
    uint8_t fg, bg; // the colours cells_put and cells_clear use
    CellRGB palette[CELLS_PALETTE];
    int palette_len;
    // cells_put/fill/box are clipped to this, in cells; the renderer's scissor commands set it
    int clip_x0, clip_y0, clip_x1, clip_y1;
} Cells;

void cells_init(Cells *g, int cols, int rows);
void cells_free(Cells *g);
void cells_clear(Cells *g);
/** The palette index of an RGB triple, adding it when it is new; 0 when the palette is full. */
uint8_t cells_color(Cells *g, uint8_t r, uint8_t g_, uint8_t b);
void cells_clip(Cells *g, int x0, int y0, int x1, int y1);
/** Text at (col,row), one row, one cell per code point, clipped to the grid and the clip rect. len < 0: strlen. */
void cells_put(Cells *g, int col, int row, const char *text, int len);
void cells_fill(Cells *g, int col, int row, int w, int h, uint8_t bg);
/** A box-drawing frame on the perimeter of the rect; sides is CELLS_TOP|RIGHT|BOTTOM|LEFT. */
void cells_box(Cells *g, int col, int row, int w, int h, uint8_t fg, int sides);
/** The grid as ANSI: SGR runs merged (no escape when a cell keeps its colours), one cursor move a row. */
void cells_ansi(const Cells *g, FILE *out);
/** The grid as plain text, one line a row: the glyphs, spaces, and '.' where a cell is filled with another colour
 * than the page's (the top-left cell), so a fill is visible without escapes. Trailing spaces are trimmed. After the
 * grid, "# colours: index rgb glyphs fills" lists every palette colour a cell uses, with how many cells carry it as
 * text and as background: a plain-text frame cannot show a theme change otherwise. */
void cells_dump(const Cells *g, FILE *out);
/** UTF-8 code points in text[0..len), for the measure function: a monospace cell each. */
int cells_utf8_count(const char *text, int len);

#endif
