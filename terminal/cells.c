#include "cells.h"

#include <stdlib.h>
#include <string.h>

// The first bytes of a UTF-8 sequence, and how many bytes it claims. A continuation byte that is not one, or a
// truncated sequence, is one byte (the decoder never runs past len).
static int utf8_len(const char *text, int i, int len)
{
    const unsigned char b = (unsigned char)text[i];
    int n = b < 0x80 ? 1 : (b >> 5) == 6 ? 2 : (b >> 4) == 14 ? 3 : (b >> 3) == 30 ? 4 : 1;
    return n > len - i ? len - i : n;
}

int cells_utf8_count(const char *text, int len)
{
    int n = 0;
    for (int i = 0; i < len;) i += utf8_len(text, i, len), n++;
    return n;
}

void cells_init(Cells *g, int cols, int rows)
{
    memset(g, 0, sizeof *g);
    g->cols = cols > 0 ? cols : 1;
    g->rows = rows > 0 ? rows : 1;
    g->cells = calloc((size_t)g->cols * g->rows, sizeof *g->cells);
    if (!g->cells) abort();
    // 0 is the text colour, 1 the page: the Sensors page's dark ground, so a frame with no fill still reads
    g->fg = cells_color(g, 230, 230, 230);
    g->bg = cells_color(g, 16, 18, 24);
    cells_clear(g);
}

void cells_free(Cells *g)
{
    free(g->cells);
    g->cells = NULL;
}

void cells_clear(Cells *g)
{
    for (int i = 0; i < g->cols * g->rows; i++) {
        g->cells[i].bytes[0] = 0;
        g->cells[i].fg = 0; // cells_init adds the text colour first, so 0 is the default
        g->cells[i].bg = g->bg;
    }
    g->fg = 0;
    cells_clip(g, 0, 0, g->cols, g->rows);
}

uint8_t cells_color(Cells *g, uint8_t r, uint8_t g_, uint8_t b)
{
    for (int i = 0; i < g->palette_len; i++)
        if (g->palette[i].r == r && g->palette[i].g == g_ && g->palette[i].b == b) return (uint8_t)i;
    if (g->palette_len >= CELLS_PALETTE) return 0;
    g->palette[g->palette_len] = (CellRGB){r, g_, b};
    return (uint8_t)g->palette_len++;
}

void cells_clip(Cells *g, int x0, int y0, int x1, int y1)
{
    g->clip_x0 = x0 < 0 ? 0 : x0 > g->cols ? g->cols : x0;
    g->clip_y0 = y0 < 0 ? 0 : y0 > g->rows ? g->rows : y0;
    g->clip_x1 = x1 < 0 ? 0 : x1 > g->cols ? g->cols : x1;
    g->clip_y1 = y1 < 0 ? 0 : y1 > g->rows ? g->rows : y1;
}

static int inside(const Cells *g, int col, int row)
{
    return col >= g->clip_x0 && col < g->clip_x1 && row >= g->clip_y0 && row < g->clip_y1;
}

static void set_cell(Cells *g, int col, int row, const char *bytes, uint8_t fg)
{
    if (!inside(g, col, row)) return;
    Cell *c = &g->cells[row * g->cols + col];
    memset(c->bytes, 0, sizeof c->bytes);
    strncpy(c->bytes, bytes, 4);
    c->fg = fg;
}

void cells_put(Cells *g, int col, int row, const char *text, int len)
{
    if (!text) return;
    if (len < 0) len = (int)strlen(text);
    for (int i = 0, c = col; i < len && text[i]; c++) {
        const unsigned char b = (unsigned char)text[i];
        const int n = utf8_len(text, i, len);
        char one[5] = {' ', 0, 0, 0, 0};
        // a control byte (a newline in a text run) is a space: this layer draws one row, it does not wrap
        if (b >= 0x20) memcpy(one, text + i, (size_t)n), one[n] = 0;
        // ponytail: one cell a code point, so a wide CJK glyph or an emoji would take one cell and break the row by
        // one; a width table (wcwidth) is the upgrade when a page needs them
        set_cell(g, c, row, one, g->fg);
        i += n;
    }
}

void cells_fill(Cells *g, int col, int row, int w, int h, uint8_t bg)
{
    for (int y = row; y < row + h; y++)
        for (int x = col; x < col + w; x++) {
            if (!inside(g, x, y)) continue;
            Cell *c = &g->cells[y * g->cols + x];
            c->bytes[0] = 0;
            c->bg = bg;
        }
}

void cells_box(Cells *g, int col, int row, int w, int h, uint8_t fg, int sides)
{
    if (w <= 0 || h <= 0) return;
    const int x1 = col + w - 1, y1 = row + h - 1;
    if (sides & CELLS_TOP)
        for (int x = col; x <= x1; x++) set_cell(g, x, row, "\xe2\x94\x80", fg); // ─
    if (sides & CELLS_BOTTOM)
        for (int x = col; x <= x1; x++) set_cell(g, x, y1, "\xe2\x94\x80", fg);
    if (sides & CELLS_LEFT)
        for (int y = row; y <= y1; y++) set_cell(g, col, y, "\xe2\x94\x82", fg); // │
    if (sides & CELLS_RIGHT)
        for (int y = row; y <= y1; y++) set_cell(g, x1, y, "\xe2\x94\x82", fg);
    // corners last, each only when both sides that meet there are drawn; else the side's own line arrives there
    if ((sides & (CELLS_TOP | CELLS_LEFT)) == (CELLS_TOP | CELLS_LEFT)) set_cell(g, col, row, "\xe2\x94\x8c", fg); // ┌
    if ((sides & (CELLS_TOP | CELLS_RIGHT)) == (CELLS_TOP | CELLS_RIGHT)) set_cell(g, x1, row, "\xe2\x94\x90", fg); // ┐
    if ((sides & (CELLS_BOTTOM | CELLS_LEFT)) == (CELLS_BOTTOM | CELLS_LEFT)) set_cell(g, col, y1, "\xe2\x94\x94", fg); // └
    if ((sides & (CELLS_BOTTOM | CELLS_RIGHT)) == (CELLS_BOTTOM | CELLS_RIGHT)) set_cell(g, x1, y1, "\xe2\x94\x98", fg); // ┘
}

void cells_ansi(const Cells *g, FILE *out)
{
    for (int y = 0; y < g->rows; y++) {
        // a cursor move a row: no reliance on the terminal's wrap at the last column, and the file is fixed
        fprintf(out, "\x1b[%d;1H", y + 1);
        int fg = -1, bg = -1;
        for (int x = 0; x < g->cols; x++) {
            const Cell *c = &g->cells[y * g->cols + x];
            if (c->fg != fg) {
                const CellRGB *p = &g->palette[c->fg];
                fprintf(out, "\x1b[38;2;%u;%u;%um", p->r, p->g, p->b);
                fg = c->fg;
            }
            if (c->bg != bg) {
                const CellRGB *p = &g->palette[c->bg];
                fprintf(out, "\x1b[48;2;%u;%u;%um", p->r, p->g, p->b);
                bg = c->bg;
            }
            fputs(c->bytes[0] ? c->bytes : " ", out);
        }
        fputs("\x1b[0m", out);
    }
}

void cells_dump(const Cells *g, FILE *out)
{
    // the page is whatever fills the top-left cell; any other background is a fill and prints as a dot
    const uint8_t page = g->cols > 0 && g->rows > 0 ? g->cells[0].bg : 0;
    for (int y = 0; y < g->rows; y++) {
        int last = -1;
        for (int x = 0; x < g->cols; x++) {
            const Cell *c = &g->cells[y * g->cols + x];
            if (c->bytes[0] && c->bytes[0] != ' ') last = x;
            else if (!c->bytes[0] && c->bg != page) last = x;
        }
        for (int x = 0; x <= last; x++) {
            const Cell *c = &g->cells[y * g->cols + x];
            if (c->bytes[0]) fputs(c->bytes, out);
            else fputc(c->bg != page ? '.' : ' ', out);
        }
        fputc('\n', out);
    }
    // the colours: a theme is a palette, and a plain-text grid of glyphs would look the same in both
    int glyphs[CELLS_PALETTE] = {0}, fills[CELLS_PALETTE] = {0};
    for (int i = 0; i < g->cols * g->rows; i++) {
        if (g->cells[i].bytes[0]) glyphs[g->cells[i].fg]++;
        fills[g->cells[i].bg]++;
    }
    fputs("# colours: index rgb glyphs fills\n", out);
    for (int i = 0; i < g->palette_len; i++)
        if (glyphs[i] || fills[i])
            fprintf(out, "%d %u,%u,%u %d %d\n", i, g->palette[i].r, g->palette[i].g, g->palette[i].b, glyphs[i],
                    fills[i]);
}
