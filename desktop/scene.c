// The C host's scene reader: the subset of solid/src/scene.ts's format a page with no JS can replay. Strict on
// purpose — a key or a step it does not know is an error, not a skip — and small: the format is strings, numbers,
// booleans and arrays, so the parser is one recursive descent over those.
//
// Limits, stated:
//   — the kinds are `pointer`, `settle` and `frame`: `key`, `text` and `wheel` are the Solid pages' and are refused by
//     name (a generated page's table carries a click only);
//   — a string is UTF-8 passed through, with `\" \\ \/ \b \f \n \r \t` and no `\uXXXX` (a scene is names and page ids,
//     not text);
//   — a number is JSON's grammar, read by `strtod`: no hex, no `inf`, no `nan`;
//   — no `null`, no nested objects beyond the top level and a step, and no unknown key (an object's keys are read by
//     name, and one it does not know is an error);
//   — a step's time is rounded to 1/60s and must not go back, exactly as solid/src/scene.ts checks it.
#include "scene.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define FPS 60.0f

typedef struct {
    const char *start;
    const char *p;
    const char *end;
    char *err;
    int errlen;
} Parser;

static int fail(Parser *p, const char *what)
{
    snprintf(p->err, (size_t)p->errlen, "%s", what);
    return 0;
}

static void space(Parser *p)
{
    while (p->p < p->end && (*p->p == ' ' || *p->p == '\t' || *p->p == '\n' || *p->p == '\r')) p->p++;
}

/** `c`, or an error; the whitespace before it is the format's. */
static int take(Parser *p, char c)
{
    space(p);
    if (p->p >= p->end) return fail(p, "unexpected end of the file");
    if (*p->p != c) {
        char what[64];
        snprintf(what, sizeof what, "expected '%c', found '%c'", c, *p->p);
        return fail(p, what);
    }
    p->p++;
    return 1;
}

/** A quoted string, escapes resolved: `\" \\ \/ \b \f \n \r \t`, and nothing else. */
static int string(Parser *p, char *out, int cap)
{
    if (!take(p, '"')) return 0;
    int n = 0;
    while (p->p < p->end) {
        const unsigned char c = (unsigned char)*p->p++;
        if (c == '"') {
            out[n < cap ? n : cap - 1] = '\0';
            return 1;
        }
        if (c < 0x20) return fail(p, "a control character in a string");
        char v = (char)c;
        if (c == '\\') {
            if (p->p >= p->end) return fail(p, "a string ends in a backslash");
            const char e = *p->p++;
            switch (e) {
            case '"': v = '"'; break;
            case '\\': v = '\\'; break;
            case '/': v = '/'; break;
            case 'b': v = '\b'; break;
            case 'f': v = '\f'; break;
            case 'n': v = '\n'; break;
            case 'r': v = '\r'; break;
            case 't': v = '\t'; break;
            case 'u': return fail(p, "\\u escapes are not read: a scene is names and page ids, not text");
            default:
                snprintf(p->err, (size_t)p->errlen, "unknown escape \\%c", e);
                return 0;
            }
        }
        if (n < cap - 1) out[n] = v;
        n++;
    }
    return fail(p, "the file ends inside a string");
}

/** A JSON number, by its grammar (`-?(0|[1-9]…)(.…)?([eE]…)?`), converted with `strtod`. */
static int number(Parser *p, float *out)
{
    space(p);
    const char *s = p->p;
    if (p->p < p->end && *p->p == '-') p->p++;
    if (p->p >= p->end) return fail(p, "expected a number");
    if (*p->p == '0') p->p++;
    else if (*p->p >= '1' && *p->p <= '9')
        while (p->p < p->end && *p->p >= '0' && *p->p <= '9') p->p++;
    else return fail(p, "expected a number");
    if (p->p < p->end && *p->p == '.') {
        p->p++;
        if (p->p >= p->end || *p->p < '0' || *p->p > '9') return fail(p, "a decimal point with no digits after it");
        while (p->p < p->end && *p->p >= '0' && *p->p <= '9') p->p++;
    }
    if (p->p < p->end && (*p->p == 'e' || *p->p == 'E')) {
        p->p++;
        if (p->p < p->end && (*p->p == '+' || *p->p == '-')) p->p++;
        if (p->p >= p->end || *p->p < '0' || *p->p > '9') return fail(p, "an exponent with no digits after it");
        while (p->p < p->end && *p->p >= '0' && *p->p <= '9') p->p++;
    }
    *out = (float)strtod(s, NULL);
    return 1;
}

static int boolean(Parser *p, int *out)
{
    space(p);
    if ((size_t)(p->end - p->p) >= 4 && !strncmp(p->p, "true", 4)) {
        p->p += 4;
        *out = 1;
        return 1;
    }
    if ((size_t)(p->end - p->p) >= 5 && !strncmp(p->p, "false", 5)) {
        p->p += 5;
        *out = 0;
        return 1;
    }
    return fail(p, "expected true or false");
}

/** `"key" :` — the key read and the colon taken. */
static int key(Parser *p, char *out, int cap)
{
    if (!string(p, out, cap)) return 0;
    return take(p, ':');
}

/** The next token is `}` or `,` (an object's or an array's element boundary, the caller owns the closing). */
static int more(Parser *p, int *first, char close)
{
    space(p);
    if (p->p < p->end && *p->p == close) {
        p->p++;
        return 0; // the end
    }
    if (!*first) {
        if (!take(p, ',')) return -1;
        space(p);
        if (p->p < p->end && *p->p == close) {
            fail(p, "a trailing comma");
            return -1;
        }
    }
    *first = 0;
    return 1;
}

static int read_scene(Parser *p, Scene *s);

/** One step: `{ "t", "kind", ... }`, its frame computed and its order checked. */
static int read_step(Parser *p, Scene *s, int prevFrame, float prevT)
{
    const int index = s->count;
    if (index >= SCENE_MAX_STEPS) {
        snprintf(p->err, (size_t)p->errlen, "more than %d steps", SCENE_MAX_STEPS);
        return 0;
    }
    SceneStep *step = &s->steps[index];
    memset(step, 0, sizeof *step);
    int haveT = 0, haveKind = 0, haveX = 0, haveY = 0, haveDown = 0, haveFrames = 0;
    char kind[16] = "";
    if (!take(p, '{')) return 0;
    int first = 1;
    for (;;) {
        const int next = more(p, &first, '}');
        if (next < 0) return 0;
        if (next == 0) break;
        char name[32];
        if (!key(p, name, sizeof name)) return 0;
        if (!strcmp(name, "t")) {
            if (!number(p, &step->t)) return 0;
            if (step->t < 0) {
                snprintf(p->err, (size_t)p->errlen, "step %d: t must be 0 or more", index);
                return 0;
            }
            haveT = 1;
        } else if (!strcmp(name, "kind")) {
            if (!string(p, kind, sizeof kind)) return 0;
            haveKind = 1;
        } else if (!strcmp(name, "x")) {
            if (!number(p, &step->x)) return 0;
            haveX = 1;
        } else if (!strcmp(name, "y")) {
            if (!number(p, &step->y)) return 0;
            haveY = 1;
        } else if (!strcmp(name, "down")) {
            if (!boolean(p, &step->down)) return 0;
            haveDown = 1;
        } else if (!strcmp(name, "touch")) {
            int touch;
            if (!boolean(p, &touch)) return 0;
        } else if (!strcmp(name, "frames")) {
            float frames;
            if (!number(p, &frames)) return 0;
            if (frames < 0 || frames > 100000 || frames != (float)(int)frames) {
                snprintf(p->err, (size_t)p->errlen, "step %d: frames must be a whole number, 0 or more", index);
                return 0;
            }
            step->frames = (int)frames;
            haveFrames = 1;
        } else {
            snprintf(p->err, (size_t)p->errlen, "step %d: unknown key \"%s\"", index, name);
            return 0;
        }
    }
    if (!haveT) {
        snprintf(p->err, (size_t)p->errlen, "step %d: no t", index);
        return 0;
    }
    if (!haveKind) {
        snprintf(p->err, (size_t)p->errlen, "step %d: no kind", index);
        return 0;
    }
    step->frame = (int)lroundf(step->t * FPS);
    // a step's frame is the unit input lands on, so a step that goes back is a scene that cannot be replayed
    if (index > 0 && step->frame < prevFrame) {
        snprintf(p->err, (size_t)p->errlen,
                 "step %d: out of order: t %g is frame %d, after a step at t %g (frame %d)", index, step->t,
                 step->frame, prevT, prevFrame);
        return 0;
    }
    if (!strcmp(kind, "pointer")) {
        if (!haveX || !haveY || !haveDown) {
            snprintf(p->err, (size_t)p->errlen, "step %d: a pointer step is { \"t\", \"kind\", \"x\", \"y\", \"down\" }",
                     index);
            return 0;
        }
        step->kind = SCENE_POINTER;
    } else if (!strcmp(kind, "settle")) {
        if (!haveFrames) {
            snprintf(p->err, (size_t)p->errlen, "step %d: a settle step is { \"t\", \"kind\", \"frames\" }", index);
            return 0;
        }
        step->kind = SCENE_SETTLE;
    } else if (!strcmp(kind, "frame")) {
        step->kind = SCENE_FRAME;
    } else {
        snprintf(p->err, (size_t)p->errlen,
                 "step %d: kind \"%s\" is not pointer, settle or frame (a page with no JS carries a click, not keys, "
                 "typed text or a wheel)",
                 index, kind);
        return 0;
    }
    s->count++;
    return 1;
}

static int read_steps(Parser *p, Scene *s)
{
    if (!take(p, '[')) return 0;
    int first = 1;
    for (;;) {
        const int next = more(p, &first, ']');
        if (next < 0) return 0;
        if (next == 0) break;
        const int i = s->count;
        const int prevFrame = i > 0 ? s->steps[i - 1].frame : 0;
        const float prevT = i > 0 ? s->steps[i - 1].t : 0;
        if (!read_step(p, s, prevFrame, prevT)) return 0;
    }
    return 1;
}

static int read_size(Parser *p, Scene *s)
{
    if (!take(p, '[')) return 0;
    int first = 1;
    float v[2];
    int n = 0;
    for (;;) {
        const int next = more(p, &first, ']');
        if (next < 0) return 0;
        if (next == 0) break;
        if (n == 2) return fail(p, "size has more than two numbers");
        if (!number(p, &v[n++])) return 0;
    }
    if (n != 2 || v[0] != (float)(int)v[0] || v[1] != (float)(int)v[1] || v[0] <= 0 || v[1] <= 0)
        return fail(p, "size must be [width, height], two whole pixels");
    s->width = (int)v[0];
    s->height = (int)v[1];
    return 1;
}

static int read_scene(Parser *p, Scene *s)
{
    int haveName = 0, havePage = 0, haveSize = 0, haveTheme = 0;
    char text[64];
    if (!take(p, '{')) return 0;
    int first = 1;
    for (;;) {
        const int next = more(p, &first, '}');
        if (next < 0) return 0;
        if (next == 0) break;
        char name[32];
        if (!key(p, name, sizeof name)) return 0;
        if (!strcmp(name, "name")) {
            if (!string(p, s->name, sizeof s->name)) return 0;
            haveName = 1;
        } else if (!strcmp(name, "page")) {
            if (!string(p, s->page, sizeof s->page)) return 0;
            havePage = 1;
        } else if (!strcmp(name, "size")) {
            if (!read_size(p, s)) return 0;
            haveSize = 1;
        } else if (!strcmp(name, "theme")) {
            if (!string(p, text, sizeof text)) return 0;
            if (strcmp(text, "dark") && strcmp(text, "light")) {
                snprintf(p->err, (size_t)p->errlen, "theme \"%s\" is not \"dark\" or \"light\"", text);
                return 0;
            }
            s->light = !strcmp(text, "light");
            haveTheme = 1;
        } else if (!strcmp(name, "reducedMotion")) {
            if (!boolean(p, &s->reducedMotion)) return 0;
        } else if (!strcmp(name, "steps")) {
            if (!read_steps(p, s)) return 0;
        } else {
            snprintf(p->err, (size_t)p->errlen, "unknown key \"%s\"", name);
            return 0;
        }
    }
    if (!haveName || !s->name[0]) return fail(p, "name must be a non-empty string");
    if (!havePage || !s->page[0]) return fail(p, "page must be a non-empty string");
    if (!haveSize) return fail(p, "size must be [width, height]");
    if (!haveTheme) return fail(p, "theme must be \"dark\" or \"light\"");
    return 1;
}

int scene_read(const char *path, Scene *scene, char *err, int errlen)
{
    memset(scene, 0, sizeof *scene);
    err[0] = '\0';
    FILE *f = fopen(path, "rb");
    if (!f) {
        snprintf(err, (size_t)errlen, "cannot open %s", path);
        return -1;
    }
    fseek(f, 0, SEEK_END);
    const long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *bytes = malloc((size_t)size + 1);
    if (!bytes || fread(bytes, 1, (size_t)size, f) != (size_t)size) {
        free(bytes);
        fclose(f);
        snprintf(err, (size_t)errlen, "cannot read %s", path);
        return -1;
    }
    fclose(f);
    bytes[size] = '\0';

    Parser p = {.start = bytes, .p = bytes, .end = bytes + size, .err = err, .errlen = errlen};
    int ok = read_scene(&p, scene);
    if (ok) {
        space(&p);
        if (p.p != p.end) {
            snprintf(err, (size_t)errlen, "trailing bytes at byte %d", (int)(p.p - p.start));
            ok = 0;
        }
    }
    if (!ok && err[0]) {
        char detail[256];
        snprintf(detail, sizeof detail, "%s", err);
        snprintf(err, (size_t)errlen, "%s: %s", path, detail);
    }
    free(bytes);
    return ok ? 0 : -1;
}
