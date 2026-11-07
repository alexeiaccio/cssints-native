// The code pane's checks, and the pane: highlighted TSX on the grid. `code` prints a file as a plain-text dump; with
// `--ansi` the same grid as the escapes a terminal gets; with no file it only runs the checks.
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cells.h"
#include "code.h"

static int failures;

static void check(int ok, const char *what)
{
    if (ok) return;
    failures++;
    fprintf(stderr, "FAIL: %s\n", what);
}

static double channel(double v)
{
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4);
}

// WCAG 2.1's contrast ratio: the same number the theme's check prints for a text colour.
static double contrast(CellRGB a, CellRGB b)
{
    const double la = 0.2126 * channel(a.r) + 0.7152 * channel(a.g) + 0.0722 * channel(a.b);
    const double lb = 0.2126 * channel(b.r) + 0.7152 * channel(b.g) + 0.0722 * channel(b.b);
    return (la > lb ? la + 0.05 : lb + 0.05) / (la > lb ? lb + 0.05 : la + 0.05);
}

static char glyph(const Cells *g, int x, int y) { return g->cells[y * g->cols + x].bytes[0]; }
static uint8_t fg(const Cells *g, int x, int y) { return g->cells[y * g->cols + x].fg; }

// the palette index of a theme colour, as code_draw found it (cells_color is idempotent)
static uint8_t color(const Cells *g, CodeKind kind)
{
    const CellRGB c = CODE_THEME_DARK.color[kind];
    return cells_color((Cells *)g, c.r, c.g, c.b);
}

static void checks(void)
{
    const char *problem = code_query_problem();
    if (problem) fprintf(stderr, "the query: %s\n", problem);
    check(problem == NULL, "the vendored query is one the highlighter handles");

    for (int kind = 0; kind < CODE_KINDS; kind++) {
        const double ratio = contrast(CODE_THEME_DARK.color[kind], CODE_THEME_DARK.background);
        char what[96];
        snprintf(what, sizeof what, "kind %d's colour is 4.5:1 on the background (%.2f)", kind, ratio);
        check(ratio >= 4.5, what);
    }
    check(code_kind("nonesuch") == CODE_TEXT, "a capture the table does not know is the text colour");
    check(code_kind("function.method") == CODE_FUNCTION, "a dotted capture is its base");

    Cells g;
    cells_init(&g, 40, 8);
    const char *src = "const n = 42; // note\nconst s = \"hi\";\n";
    const int rows = code_draw(&g, 0, 0, 40, 8, src, (int)strlen(src), &CODE_THEME_DARK);
    check(rows == 2, "one row a line");
    check(fg(&g, 0, 0) == color(&g, CODE_KEYWORD), "`const` is a keyword");
    check(fg(&g, 6, 0) == color(&g, CODE_VARIABLE), "`n` is a variable");
    check(fg(&g, 10, 0) == color(&g, CODE_NUMBER), "`42` is a number");
    check(fg(&g, 14, 0) == color(&g, CODE_COMMENT), "`//` is a comment");
    check(fg(&g, 10, 1) == color(&g, CODE_STRING), "the string is a string");
    check(color(&g, CODE_KEYWORD) != color(&g, CODE_STRING), "two kinds, two colours");

    cells_clear(&g);
    check(code_draw(&g, 0, 0, 40, 2, "a\tb\nc", 5, &CODE_THEME_DARK) == 2, "a tab and a newline are two rows");
    check(glyph(&g, 4, 0) == 'b', "a tab is the next multiple of 4");
    check(glyph(&g, 0, 1) == 'c', "a newline is a row");

    cells_clear(&g);
    code_draw(&g, 2, 0, 4, 1, "0123456789", 10, &CODE_THEME_DARK);
    check(glyph(&g, 2, 0) == '0' && glyph(&g, 5, 0) == '3', "the rect starts at its column");
    check(glyph(&g, 6, 0) == 0, "a line wider than the rect is clipped");

    cells_clear(&g);
    check(code_draw(&g, 0, 0, 40, 2, "const = ;", 9, &CODE_THEME_DARK) >= 1,
          "a source that does not parse still draws");

    // the tags and their attributes are the JSX half of the query
    cells_clear(&g);
    const char *jsx = "<Units value={n} />\n";
    code_draw(&g, 0, 0, 40, 2, jsx, (int)strlen(jsx), &CODE_THEME_DARK);
    check(fg(&g, 1, 0) == color(&g, CODE_TAG), "a capitalised JSX name is a tag");
    check(fg(&g, 7, 0) == color(&g, CODE_ATTRIBUTE), "an attribute is an attribute");

    cells_free(&g);
}

static char *slurp(const char *path, int *len)
{
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    if (fseek(f, 0, SEEK_END) || (*len = (int)ftell(f)) < 0) {
        fclose(f);
        return NULL;
    }
    rewind(f);
    char *src = malloc((size_t)*len + 1);
    if (src && (int)fread(src, 1, (size_t)*len, f) != *len) {
        free(src);
        src = NULL;
    }
    fclose(f);
    if (src) src[*len] = '\0';
    return src;
}

int main(int argc, char **argv)
{
    checks();
    if (failures) return 1;
    if (argc < 2) {
        printf("code: ok — the query, the theme and the grid\n");
        return 0;
    }
    int len = 0;
    char *src = slurp(argv[1], &len);
    if (!src) {
        fprintf(stderr, "code: cannot read %s\n", argv[1]);
        return 2;
    }
    Cells g;
    cells_init(&g, 80, 24);
    code_draw(&g, 0, 0, g.cols, g.rows, src, len, &CODE_THEME_DARK);
    if (argc > 2 && !strcmp(argv[2], "--ansi")) cells_ansi(&g, stdout);
    else cells_dump(&g, stdout);
    cells_free(&g);
    free(src);
    return 0;
}
