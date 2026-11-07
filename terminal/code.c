#include "code.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <tree_sitter/api.h>

#include "highlights.h"

// tsx/src/parser.c's entry point
extern const TSLanguage *tree_sitter_tsx(void);

const CodeTheme CODE_THEME_DARK = {
    .color =
        {
            [CODE_TEXT] = {230, 230, 230},
            [CODE_COMMENT] = {124, 132, 150},
            [CODE_KEYWORD] = {198, 120, 221},
            [CODE_TYPE] = {86, 182, 194},
            [CODE_FUNCTION] = {97, 175, 239},
            [CODE_CONSTRUCTOR] = {229, 192, 123},
            [CODE_PROPERTY] = {171, 178, 191},
            [CODE_VARIABLE] = {224, 224, 224},
            [CODE_STRING] = {152, 195, 121},
            [CODE_NUMBER] = {209, 154, 102},
            [CODE_CONSTANT] = {229, 192, 123},
            [CODE_OPERATOR] = {86, 182, 194},
            [CODE_PUNCTUATION] = {140, 148, 165},
            [CODE_TAG] = {224, 108, 117},
            [CODE_ATTRIBUTE] = {209, 154, 102},
            [CODE_EMBEDDED] = {230, 230, 230},
        },
    .background = {16, 18, 24},
};

// The capture bases the query uses, and the colour each paints. `text` is the JSX text between tags: the page's own
// colour, and the only base CODE_TEXT is named for.
static const struct {
    const char *base;
    CodeKind kind;
} NAMES[] = {
    {"attribute", CODE_ATTRIBUTE}, {"boolean", CODE_CONSTANT},    {"comment", CODE_COMMENT},
    {"constant", CODE_CONSTANT},   {"constructor", CODE_CONSTRUCTOR}, {"embedded", CODE_EMBEDDED},
    {"function", CODE_FUNCTION},   {"keyword", CODE_KEYWORD},     {"nested", CODE_TYPE},
    {"number", CODE_NUMBER},       {"operator", CODE_OPERATOR},   {"property", CODE_PROPERTY},
    {"punctuation", CODE_PUNCTUATION}, {"string", CODE_STRING},   {"tag", CODE_TAG},
    {"text", CODE_TEXT},           {"type", CODE_TYPE},           {"variable", CODE_VARIABLE},
};

// Which colour wins where two captures cover the same text: a variable naming a component is a tag, `css.cn` is a
// function though it is also a property, `MAX_ROWS` is a constant. The query cannot order them (a rule's position is
// provenance, not priority), so the kinds are ranked: a code kind beats the string or the template it sits in, and the
// generic names a variable, a property sit at the bottom.
static const uint8_t RANK[CODE_KINDS] = {
    [CODE_TEXT] = 0,       [CODE_EMBEDDED] = 1, [CODE_STRING] = 2,      [CODE_NUMBER] = 3,
    [CODE_VARIABLE] = 4,   [CODE_PROPERTY] = 5, [CODE_PUNCTUATION] = 6, [CODE_OPERATOR] = 7,
    [CODE_CONSTANT] = 8,   [CODE_FUNCTION] = 9, [CODE_TYPE] = 10,       [CODE_CONSTRUCTOR] = 11,
    [CODE_KEYWORD] = 12,   [CODE_TAG] = 13,     [CODE_ATTRIBUTE] = 14,  [CODE_COMMENT] = 15,
};

// -1 for a name that is not in the table, so code_query_problem can tell `text` from a name nobody classified.
static int kind_of(const char *name)
{
    for (size_t i = 0; i < sizeof NAMES / sizeof *NAMES; i++) {
        const size_t len = strlen(NAMES[i].base);
        if (!strncmp(name, NAMES[i].base, len) && (name[len] == '\0' || name[len] == '.')) return NAMES[i].kind;
    }
    return -1;
}

CodeKind code_kind(const char *name)
{
    const int kind = name ? kind_of(name) : -1;
    return kind < 0 ? CODE_TEXT : (CodeKind)kind;
}

// The query is compiled once: 12 KB of source, and the same for every file drawn.
static TSQuery *query(void)
{
    static TSQuery *q;
    static int broken;
    if (q || broken) return q;
    uint32_t offset = 0;
    TSQueryError error = TSQueryErrorNone;
    const char *src = TSX_HIGHLIGHTS;
    q = ts_query_new(tree_sitter_tsx(), src, (uint32_t)strlen(src), &offset, &error);
    if (!q) {
        fprintf(stderr, "code: the highlight query does not compile (%d at byte %u)\n", (int)error, offset);
        broken = 1;
    }
    return q;
}

// tree-sitter reports a predicate, it does not evaluate it. The vendored query uses four spellings; anything else
// drops the capture and is reported once, so a query that grows a predicate is heard rather than silently uncoloured.
static const struct {
    const char *name, *pattern; // a NULL pattern: any text (`#eq?` compares it)
} PREDICATES[] = {
    {"eq?", NULL},
    {"match?", "^[A-Z][A-Z0-9_]*$"},
    {"match?", "^[a-z]"},
    {"not-match?", "^[a-z][^.]*$"},
};

static const char *predicate_problem(const char *name, const char *pattern)
{
    for (size_t i = 0; i < sizeof PREDICATES / sizeof *PREDICATES; i++)
        if (!strcmp(name, PREDICATES[i].name) && (!PREDICATES[i].pattern || !strcmp(pattern, PREDICATES[i].pattern)))
            return NULL;
    static char problem[160];
    snprintf(problem, sizeof problem, "#%s with %s", name, pattern);
    return problem;
}

static void step_text(TSQuery *q, TSQueryPredicateStep step, char *out, size_t cap)
{
    out[0] = '\0';
    if (step.type != TSQueryPredicateStepTypeString) return;
    uint32_t len = 0;
    const char *text = ts_query_string_value_for_id(q, step.value_id, &len);
    if (len >= cap) len = (uint32_t)cap - 1;
    memcpy(out, text, len);
    out[len] = '\0';
}

// The text of the capture a predicate names, in this match.
static int capture_text(const TSQueryMatch *m, const char *src, uint32_t id, const char **text, int *len)
{
    for (uint32_t i = 0; i < m->capture_count; i++) {
        if (m->captures[i].index != id) continue;
        const uint32_t start = ts_node_start_byte(m->captures[i].node);
        *text = src + start;
        *len = (int)(ts_node_end_byte(m->captures[i].node) - start);
        return 1;
    }
    return 0;
}

static int upper_ident(const char *s, int len)
{
    if (len < 1 || s[0] < 'A' || s[0] > 'Z') return 0;
    for (int i = 1; i < len; i++)
        if (!((s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= '0' && s[i] <= '9') || s[i] == '_')) return 0;
    return 1;
}

static int lower_no_dot(const char *s, int len)
{
    if (len < 1 || s[0] < 'a' || s[0] > 'z') return 0;
    for (int i = 1; i < len; i++)
        if (s[i] == '.') return 0;
    return 1;
}

// One predicate: `steps` holds its name, its arguments and no Done.
static int predicate_holds(TSQuery *q, const TSQueryMatch *m, const char *src, const TSQueryPredicateStep *steps,
                           uint32_t n)
{
    if (n < 3) return 0;
    char name[32], pattern[64];
    step_text(q, steps[0], name, sizeof name);
    step_text(q, steps[2], pattern, sizeof pattern);
    if (steps[1].type != TSQueryPredicateStepTypeCapture) return 0;
    const char *text = NULL;
    int len = 0;
    if (!capture_text(m, src, steps[1].value_id, &text, &len)) return 0;
    if (predicate_problem(name, pattern)) return 0;
    if (!strcmp(name, "eq?")) return (size_t)len == strlen(pattern) && !memcmp(text, pattern, (size_t)len);
    if (!strcmp(name, "match?")) {
        if (!strcmp(pattern, "^[a-z]")) return len > 0 && *text >= 'a' && *text <= 'z';
        return upper_ident(text, len);
    }
    return !lower_no_dot(text, len); // not-match?, the only one left
}

// Every predicate of a pattern has to hold for its captures to paint.
static int match_holds(TSQuery *q, const TSQueryMatch *m, const char *src)
{
    uint32_t n = 0;
    const TSQueryPredicateStep *steps = ts_query_predicates_for_pattern(q, m->pattern_index, &n);
    for (uint32_t i = 0; i < n;) {
        const uint32_t start = i;
        while (i < n && steps[i].type != TSQueryPredicateStepTypeDone) i++;
        if (!predicate_holds(q, m, src, steps + start, i - start)) return 0;
        i++; // the Done
    }
    return 1;
}

const char *code_query_problem(void)
{
    TSQuery *q = query();
    if (!q) return "the highlight query does not compile";
    for (uint32_t p = 0, patterns = ts_query_pattern_count(q); p < patterns; p++) {
        uint32_t n = 0;
        const TSQueryPredicateStep *steps = ts_query_predicates_for_pattern(q, p, &n);
        for (uint32_t i = 0; i < n;) {
            const uint32_t start = i;
            while (i < n && steps[i].type != TSQueryPredicateStepTypeDone) i++;
            char name[32], pattern[64];
            if (i - start >= 3) {
                step_text(q, steps[start], name, sizeof name);
                step_text(q, steps[start + 2], pattern, sizeof pattern);
                const char *problem = predicate_problem(name, pattern);
                if (problem) return problem;
            } else {
                return "a predicate with no capture or no text";
            }
            i++;
        }
    }
    for (uint32_t i = 0, captures = ts_query_capture_count(q); i < captures; i++) {
        uint32_t len = 0;
        const char *name = ts_query_capture_name_for_id(q, i, &len);
        if (kind_of(name) < 0) {
            static char problem[96];
            snprintf(problem, sizeof problem, "a capture with no colour: @%.*s", (int)(len < 64 ? len : 64), name);
            return problem;
        }
    }
    return NULL;
}

typedef struct {
    uint32_t start, end, order; // byte range, and the capture's position in the query's output
    uint8_t rank, kind;
} Span;

// a wins over b: the innermost span, then the more specific kind, then the later capture
static int span_after(const Span *a, const Span *b)
{
    if (a->start != b->start) return a->start > b->start;
    if (a->rank != b->rank) return a->rank > b->rank;
    return a->order > b->order;
}

static int span_cmp(const void *a, const void *b) { return span_after(a, b) ? 1 : span_after(b, a) ? -1 : 0; }

static Span *collect(TSQuery *q, TSNode root, const char *src, int *out)
{
    *out = 0;
    if (!q) return NULL;
    size_t len = 0, cap = 256;
    Span *spans = malloc(cap * sizeof *spans);
    if (!spans) return NULL;
    TSQueryCursor *cursor = ts_query_cursor_new();
    ts_query_cursor_exec(cursor, q, root);
    TSQueryMatch m;
    uint32_t order = 0;
    while (ts_query_cursor_next_match(cursor, &m)) {
        const int holds = match_holds(q, &m, src);
        for (uint32_t i = 0; i < m.capture_count; i++, order++) {
            if (!holds) continue;
            if (len == cap) {
                Span *grown = realloc(spans, (cap *= 2) * sizeof *spans);
                if (!grown) break;
                spans = grown;
            }
            uint32_t name_len = 0;
            const char *name = ts_query_capture_name_for_id(q, m.captures[i].index, &name_len);
            char base[32];
            const uint32_t n = name_len < sizeof base - 1 ? name_len : sizeof base - 1;
            memcpy(base, name, n);
            base[n] = '\0';
            const TSNode node = m.captures[i].node;
            const CodeKind kind = code_kind(base);
            spans[len++] = (Span){ts_node_start_byte(node), ts_node_end_byte(node), order, RANK[kind], kind};
        }
    }
    ts_query_cursor_delete(cursor);
    *out = (int)len;
    return spans;
}

int code_draw(Cells *g, int col, int row, int w, int h, const char *src, int len, const CodeTheme *theme)
{
    if (!g || !src || len <= 0 || w <= 0 || h <= 0) return 0;
    if (!theme) theme = &CODE_THEME_DARK;
    TSQuery *q = query();
    int count = 0;
    Span *spans = NULL;
    TSParser *parser = ts_parser_new();
    TSTree *tree = NULL;
    if (parser && ts_parser_set_language(parser, tree_sitter_tsx()))
        tree = ts_parser_parse_string(parser, NULL, src, (uint32_t)len);
    if (tree) spans = collect(q, ts_tree_root_node(tree), src, &count);
    if (count) qsort(spans, (size_t)count, sizeof *spans, span_cmp);

    uint8_t color[CODE_KINDS];
    for (int i = 0; i < CODE_KINDS; i++)
        color[i] = cells_color(g, theme->color[i].r, theme->color[i].g, theme->color[i].b);
    int *active = malloc((size_t)(count ? count : 1) * sizeof *active);
    int nactive = 0, next = 0, x = 0, y = 0;
    for (int i = 0; active && i < len && y < h;) {
        while (next < count && spans[next].start <= (uint32_t)i) active[nactive++] = next++;
        int keep = 0;
        for (int k = 0; k < nactive; k++)
            if (spans[active[k]].end > (uint32_t)i) active[keep++] = active[k];
        nactive = keep;
        // the innermost span wins, then the more specific kind, then the later capture
        CodeKind kind = CODE_TEXT;
        const Span *best = NULL;
        for (int k = 0; k < nactive; k++)
            if (!best || span_after(&spans[active[k]], best)) best = &spans[active[k]];
        if (best) kind = (CodeKind)best->kind;
        const int n = cells_utf8_len(src, i, len);
        if (src[i] == '\n') x = 0, y++;
        else if (src[i] == '\r') {
        } else if (src[i] == '\t') x = (x / 4 + 1) * 4;
        else {
            if (x < w) cells_put_color(g, col + x, row + y, src + i, n, color[kind]);
            x++;
        }
        i += n;
    }
    free(active);
    free(spans);
    if (tree) ts_tree_delete(tree);
    if (parser) ts_parser_delete(parser);
    const int lines = y + (x > 0 ? 1 : 0);
    return lines < h ? lines : h;
}
