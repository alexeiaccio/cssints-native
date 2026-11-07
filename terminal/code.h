// Code in cells: tree-sitter's TSX grammar parses a source file and the highlight query's captures become colours
// (vendor/tree-sitter, vendor/tree-sitter-typescript's tsx grammar, vendor/tree-sitter-languages' tsx query). One row a
// line, one cell a code point, a tab to the next multiple of 4: a file pane for the terminal, not an editor.
#ifndef CODE_H
#define CODE_H

#include "cells.h"

// The colour a capture settles on: the base of its name before the first '.', so `function.method` is a function and
// `keyword.control` a keyword. CODE_TEXT is the default and also what a name the table does not know becomes.
typedef enum {
    CODE_TEXT,
    CODE_COMMENT,
    CODE_KEYWORD,
    CODE_TYPE,
    CODE_FUNCTION,
    CODE_CONSTRUCTOR,
    CODE_PROPERTY,
    CODE_VARIABLE,
    CODE_STRING,
    CODE_NUMBER,
    CODE_CONSTANT,
    CODE_OPERATOR,
    CODE_PUNCTUATION,
    CODE_TAG,
    CODE_ATTRIBUTE,
    CODE_EMBEDDED,
    CODE_KINDS
} CodeKind;

typedef struct {
    CellRGB color[CODE_KINDS];
    CellRGB background;
} CodeTheme;

// Every colour at 4.5:1 or better on its background, asserted in test_code.c.
extern const CodeTheme CODE_THEME_DARK;

// Source text into the w x h rect at (col,row), each code point in its capture's colour: '\n' a row, a tab to the next
// multiple of 4, a line wider than the rect clipped. Returns the rows written. A source the parser cannot finish is
// still drawn, in the colours its tree did give.
int code_draw(Cells *g, int col, int row, int w, int h, const char *src, int len, const CodeTheme *theme);

// The kind of a capture's name; CODE_TEXT for a name the table does not know.
CodeKind code_kind(const char *capture);

// What the vendored query asks for that the highlighter does not do, or NULL when it asks for nothing else: the four
// predicate spellings (`#match?`, `#not-match?`, `#eq?` and their patterns) and a kind for every capture name.
const char *code_query_problem(void);

#endif
