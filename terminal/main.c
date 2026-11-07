// The terminal host: a window-less frame loop. Clay lays a page out in cell-sized pixels (cols x CELL_W by rows x
// CELL_H), render.c turns the commands into a Cells grid, and a backend puts the grid out:
//
//   tb2       termbox2 (terminal/tb2.c): the grid as cells, truecolour or 256 colours, keys and the mouse
//   ansi      the grid as ANSI truecolour (headless, or to a file)
//   dump      the grid as plain text (headless; see cells_dump: '.' is a fill)
//
//   demo                            the Sensors page in the terminal, on termbox2; q or Ctrl-C quits
//   demo --page sky                 apps/csssky-tui's screens (terminal/sky.c, thread.c, profile.c, notify.c): the feed,
//                                   and the thread, the profile or the notifications it opens; Tab/arrows move the focus,
//                                   enter opens, esc back
//   demo --page thread|profile|notifications  one of those screens as the bottom of the stack (a snapshot's entry point)
//   demo --dump out.txt             one frame headless, written as plain text
//   demo --ansi out.ansi            the same frame as ANSI (the escapes a terminal gets)
//   demo --keys Tab,ArrowDown       headless: a frame, then each key with a frame after it (as solid/main.ts)
//   demo --click X,Y                headless: a frame, a pointer down over that cell with a frame, a release with a frame
//   demo --theme light              start in the light theme (or press t)
//   demo --cols N --rows N          the grid (headless default 80x26; termbox2 asks the terminal)
//   demo --backend tb2|ansi|dump    the backend (default: tb2; ansi and dump write to stdout unless a file is named)
//   demo --colors auto|truecolor|256  termbox2's output colours (auto: the terminal's COLORTERM/TERM)
//   demo --frames N                 termbox2: draw N frames, no input, then quit (a smoke check; 1 is a screen)
//
// termbox2 needs a terminal: tb_init opens /dev/tty. Headless, the tests use --dump/--ansi (and drive termbox2 through
// a pty for the backend itself: see test.sh).
#define CLAY_IMPLEMENTATION
#include "clay.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "cells.h"
#include "measure.h"
#include "page.h"
#include "render.h"
#include "shell.h"
#include "tb2.h"

static int errors;
static void on_error(Clay_ErrorData e)
{
    errors++;
    fprintf(stderr, "clay error %d: %.*s\n", (int)e.errorType, (int)e.errorText.length, e.errorText.chars);
}

static int cols = 80, rows = 26;
static Cells grid;
static const Page *page = &SENSORS_PAGE;
static TermEvent ev = {.px = -1, .py = -1};

static int quit(const TermEvent *e) { return e->key && (!strcmp(e->key, "q") || !strcmp(e->key, "Ctrl+C")); }

/** One frame: the page's input, then Clay in cells, into the grid. A page that scrolls gets another pass. */
static void frame(void)
{
    if (page->input) page->input(&ev);
    Clay_RenderCommandArray cmds = {0};
    for (int pass = 0; pass < 8; pass++) {
        Clay_SetLayoutDimensions((Clay_Dimensions){(float)(cols * CELL_W), (float)(rows * CELL_H)});
        // the pointer the backend last reported, in Clay's pixels; a click's edge is the button's for this frame
        Clay_SetPointerState((Clay_Vector2){(float)(ev.px * CELL_W), (float)(ev.py * CELL_H)}, ev.down);
        Clay_BeginLayout();
        page->declare();
        cmds = Clay_EndLayout(1.0f / 60);
        if (!page->settled || page->settled()) break;
    }
    if (getenv("DEBUG_CMDS")) {
        for (int32_t i = 0; i < cmds.length; i++) {
            Clay_RenderCommand *c = &cmds.internalArray[i];
            fprintf(stderr, "%d type %d box %.0f,%.0f %.0fx%.0f\n", i, c->commandType, c->boundingBox.x,
                    c->boundingBox.y, c->boundingBox.width, c->boundingBox.height);
        }
    }
    cells_clear(&grid);
    term_render(&grid, &cmds);
}

static void write_dump(const char *path)
{
    FILE *f = !path[0] || !strcmp(path, "-") ? stdout : fopen(path, "w");
    if (!f) {
        fprintf(stderr, "%s: %s\n", path, strerror(errno));
        exit(2);
    }
    cells_dump(&grid, f);
    if (f != stdout) fclose(f);
}

static void write_ansi(const char *path)
{
    FILE *f = !path[0] || !strcmp(path, "-") ? stdout : fopen(path, "wb");
    if (!f) {
        fprintf(stderr, "%s: %s\n", path, strerror(errno));
        exit(2);
    }
    cells_ansi(&grid, f);
    if (f != stdout) fclose(f);
}

/** termbox2: a frame, termbox2's events, a frame each; the terminal's own size, and a resize makes the grid again. */
static int interactive(Tb2Colors colors, int frames)
{
    const int rv = term_tb2_open(&cols, &rows, colors);
    if (rv != 0) {
        fprintf(stderr, "termbox2: %s (needs a terminal: use --dump or --ansi)\n", term_tb2_error());
        return 2;
    }
    cells_free(&grid);
    cells_init(&grid, cols, rows);
    frame();
    term_tb2_present(&grid);
    for (int i = 1; i < frames; i++) {
        frame();
        term_tb2_present(&grid);
    }

    int status = 0;
    while (!quit(&ev) && !frames) {
        ev.key = NULL;
        ev.down = ev.up = 0;
        const Tb2Status s = term_tb2_poll(&ev);
        if (s == TB2_QUIT) break;
        if (s == TB2_RESIZE) {
            term_tb2_size(&cols, &rows);
            cells_free(&grid);
            cells_init(&grid, cols, rows);
            ev.px = ev.py = -1;
        } else if (s != TB2_EVENT) {
            continue;
        }
        frame();
        term_tb2_present(&grid);
        if (errors) break; // Clay's error handler ran: the frame is not to be trusted
    }
    term_tb2_close();
    status = errors ? 1 : 0;
    return status;
}

int main(int argc, char **argv)
{
    const char *dump = NULL, *ansi = NULL, *keys = NULL, *click = NULL, *theme = "dark", *backend = "tb2";
    int frames = 0;
    Tb2Colors colors = TB2_COLORS_AUTO;
    for (int i = 1; i + 1 < argc; i++) {
        if (!strcmp(argv[i], "--cols")) cols = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--rows")) rows = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--dump")) dump = argv[++i];
        else if (!strcmp(argv[i], "--ansi")) ansi = argv[++i];
        else if (!strcmp(argv[i], "--keys")) keys = argv[++i];
        else if (!strcmp(argv[i], "--click")) click = argv[++i];
        else if (!strcmp(argv[i], "--theme")) theme = argv[++i];
        else if (!strcmp(argv[i], "--backend")) backend = argv[++i];
        else if (!strcmp(argv[i], "--page")) {
            const char *name = argv[++i];
            const Page *root = !strcmp(name, "thread")          ? &THREAD_PAGE
                               : !strcmp(name, "profile")       ? &PROFILE_PAGE
                               : !strcmp(name, "notifications") ? &NOTIFY_PAGE
                                                                : &SKY_PAGE;
            if (!strcmp(name, "sensors")) page = &SENSORS_PAGE;
            else if (root == &THREAD_PAGE || root == &PROFILE_PAGE || root == &NOTIFY_PAGE || !strcmp(name, "sky")) {
                shell_reset(root);
                page = &SHELL_PAGE;
            } else {
                fprintf(stderr, "unknown page %s (sensors, sky, thread, profile, notifications)\n", name);
                return 2;
            }
        }
        else if (!strcmp(argv[i], "--frames")) frames = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--colors")) {
            const char *c = argv[++i];
            colors = !strcmp(c, "truecolor") ? TB2_COLORS_TRUECOLOR : !strcmp(c, "256") ? TB2_COLORS_256 : TB2_COLORS_AUTO;
        } else {
            fprintf(stderr, "unknown option %s\n", argv[i]);
            return 2;
        }
    }
    if (cols < 4) cols = 4;
    if (rows < 3) rows = 3;

    // --backend ansi/dump with no file is that output on stdout; either file flag forces the headless path
    const int headless = dump || ansi || keys || click || !strcmp(backend, "ansi") || !strcmp(backend, "dump");
    if (!strcmp(backend, "ansi") && !ansi) ansi = "";
    if (!strcmp(backend, "dump") && !dump) dump = "";
    if (strcmp(backend, "ansi") && strcmp(backend, "dump") && strcmp(backend, "tb2")) {
        fprintf(stderr, "unknown backend %s (tb2, ansi, dump)\n", backend);
        return 2;
    }

    const uint32_t size = Clay_MinMemorySize();
    Clay_Initialize(Clay_CreateArenaWithCapacityAndMemory(size, malloc(size)),
                    (Clay_Dimensions){(float)(cols * CELL_W), (float)(rows * CELL_H)}, (Clay_ErrorHandler){on_error});
    Clay_SetMeasureTextFunction(term_measure_text, NULL);
    page_set_theme(!strcmp(theme, "light"));
    sky_light = !strcmp(theme, "light");
    if (page->reset) page->reset();
    cells_init(&grid, cols, rows);

    if (!headless) {
        const int status = interactive(colors, frames);
        cells_free(&grid);
        term_render_report();
        return status;
    }

    // headless: the base frame, then a frame after each key, then a click's press and release
    frame();
    ev.key = NULL;
    if (keys) {
        char *copy = strdup(keys);
        for (char *k = strtok(copy, ","); k; k = strtok(NULL, ",")) {
            ev.key = k;
            frame();
            ev.key = NULL;
        }
        free(copy);
    }
    if (click) {
        int x = 0, y = 0;
        if (sscanf(click, "%d,%d", &x, &y) == 2) {
            ev.px = x, ev.py = y, ev.down = 1;
            frame();
            ev.down = 0, ev.up = 1;
            frame();
            ev.up = 0;
        }
    }
    if (dump) write_dump(dump);
    if (ansi) write_ansi(ansi);
    cells_free(&grid);
    term_render_report();
    return errors ? 1 : 0;
}
