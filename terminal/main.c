// The terminal host: a window-less frame loop. Clay lays the page out in cell-sized pixels (cols x CELL_W by
// rows x CELL_H), render.c turns the commands into a Cells grid, and the grid goes out as ANSI truecolour.
//
//   demo                            the page in the terminal: raw termios, keys, redraw; q or Ctrl-C quits
//   demo --dump out.txt             one frame headless, written as plain text (see cells_dump: '.' is a fill)
//   demo --ansi out.ansi            the same frame as ANSI (the escapes a terminal gets)
//   demo --keys Tab,ArrowDown       headless: a frame, then each key with a frame after it (as solid/main.ts)
//   demo --theme light              start in the light theme (or press t)
//   demo --cols N --rows N          the grid (headless default 80x26; a terminal asks its own size)
//
// No termbox2: this step's raw termios is enough to prove the cells layer, and a later backend (termbox2 or a
// keyboard in a window) replaces input and output without touching cells.c or render.c.
#define CLAY_IMPLEMENTATION
#include "clay.h"

#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <termios.h>
#include <unistd.h>

#include "cells.h"
#include "measure.h"
#include "render.h"

void page_frame(bool down);
void page_key(const char *name);
void page_set_theme(int light);

static int errors;
static void on_error(Clay_ErrorData e)
{
    errors++;
    fprintf(stderr, "clay error %d: %.*s\n", (int)e.errorType, (int)e.errorText.length, e.errorText.chars);
}

static int cols = 80, rows = 26;
static Cells grid;
static struct termios saved;
static int raw_mode;
static volatile sig_atomic_t stop;

static void restore_terminal(void)
{
    if (!raw_mode) return;
    raw_mode = 0;
    // leave the alternate screen, show the cursor, reset the colours; then the shell's modes
    fputs("\x1b[0m\x1b[?25h\x1b[?1049l", stdout);
    fflush(stdout);
    tcsetattr(STDIN_FILENO, TCSAFLUSH, &saved);
}

static void on_signal(int sig)
{
    (void)sig;
    stop = 1;
}

/** One frame: Clay in cells, into the grid. */
static void frame(void)
{
    Clay_SetLayoutDimensions((Clay_Dimensions){(float)(cols * CELL_W), (float)(rows * CELL_H)});
    Clay_SetPointerState((Clay_Vector2){-1, -1}, false);
    Clay_BeginLayout();
    page_frame(false);
    Clay_RenderCommandArray cmds = Clay_EndLayout(1.0f / 60);
    cells_clear(&grid);
    term_render(&grid, &cmds);
    if (errors) stop = 1;
}

static int term_size(int *c, int *r)
{
    struct winsize ws;
    if (ioctl(STDOUT_FILENO, TIOCGWINSZ, &ws) || !ws.ws_col || !ws.ws_row) return 0;
    *c = ws.ws_col > 200 ? 200 : ws.ws_col, *r = ws.ws_row > 60 ? 60 : ws.ws_row;
    return 1;
}

static void write_frame(void)
{
    fputs("\x1b[H", stdout);
    cells_ansi(&grid, stdout);
    fflush(stdout);
}

/** A key name from the bytes the tty gave us, the names the desktop's focus manager uses. */
static const char *key_name(const unsigned char *b, int n, int *used)
{
    *used = 1;
    if (b[0] == 0x1b && n >= 3 && b[1] == '[') {
        *used = 3;
        switch (b[2]) {
        case 'A': return "ArrowUp";
        case 'B': return "ArrowDown";
        case 'C': return "ArrowRight";
        case 'D': return "ArrowLeft";
        case 'Z': return "Shift+Tab";
        default: *used = 1; return "Escape";
        }
    }
    if (b[0] == 0x1b) return "Escape";
    if (b[0] == '\t') return "Tab";
    if (b[0] == '\r' || b[0] == '\n') return "Enter";
    if (b[0] == ' ') return "Space";
    if (b[0] == 0x7f || b[0] == 0x08) return "Backspace";
    static char letter[2];
    if (b[0] >= 'a' && b[0] <= 'z') letter[0] = (char)b[0], letter[1] = 0;
    else if (b[0] >= '0' && b[0] <= '9') letter[0] = (char)b[0], letter[1] = 0;
    else letter[0] = 0;
    return letter[0] ? letter : NULL;
}

static int interactive(void)
{
    struct termios t;
    if (tcgetattr(STDIN_FILENO, &saved)) return 2;
    t = saved;
    // raw: no line editing, no echo, no signals (Ctrl-C arrives as 0x03 and is ours), no CR/NL translation
    t.c_lflag &= (tcflag_t) ~(ICANON | ECHO | ECHONL | IEXTEN | ISIG);
    t.c_iflag &= (tcflag_t) ~(IXON | ICRNL | INLCR | IGNCR | BRKINT);
    t.c_oflag &= (tcflag_t) ~OPOST;
    t.c_cc[VMIN] = 0;  // a read waits up to VTIME and takes what there is, so the loop can see signals
    t.c_cc[VTIME] = 1; // 100 ms
    if (tcsetattr(STDIN_FILENO, TCSAFLUSH, &t)) return 2;
    raw_mode = 1;
    atexit(restore_terminal);
    signal(SIGINT, on_signal);
    signal(SIGTERM, on_signal);
    signal(SIGHUP, on_signal);
    fputs("\x1b[?1049h\x1b[?25l\x1b[2J", stdout);
    fflush(stdout);

    int w = cols, h = rows;
    while (!stop) {
        int c, r;
        if (term_size(&c, &r) && (c != w || r != h)) {
            w = cols = c, h = rows = r;
            cells_free(&grid);
            cells_init(&grid, cols, rows);
            fputs("\x1b[2J", stdout);
        }
        frame();
        write_frame();
        unsigned char buf[32];
        const ssize_t n = read(STDIN_FILENO, buf, sizeof buf);
        for (int i = 0; i < n && !stop;) {
            if (buf[i] == 0x03) { // Ctrl-C
                stop = 1;
                break;
            }
            int used = 1;
            const char *name = key_name(buf + i, (int)n - i, &used);
            i += used;
            if (!name) continue;
            if (!strcmp(name, "q")) { // quit, like the desktop window's close
                stop = 1;
                break;
            }
            page_key(name);
        }
    }
    return errors ? 1 : 0;
}

int main(int argc, char **argv)
{
    const char *dump = NULL, *ansi = NULL, *keys = NULL;
    const char *theme = "dark";
    for (int i = 1; i + 1 < argc; i++) {
        if (!strcmp(argv[i], "--cols")) cols = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--rows")) rows = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--dump")) dump = argv[++i];
        else if (!strcmp(argv[i], "--ansi")) ansi = argv[++i];
        else if (!strcmp(argv[i], "--keys")) keys = argv[++i];
        else if (!strcmp(argv[i], "--theme")) theme = argv[++i];
        else {
            fprintf(stderr, "unknown option %s\n", argv[i]);
            return 2;
        }
    }
    if (cols < 4) cols = 4;
    if (rows < 3) rows = 3;

    const uint32_t size = Clay_MinMemorySize();
    Clay_Initialize(Clay_CreateArenaWithCapacityAndMemory(size, malloc(size)),
                    (Clay_Dimensions){(float)(cols * CELL_W), (float)(rows * CELL_H)}, (Clay_ErrorHandler){on_error});
    Clay_SetMeasureTextFunction(term_measure_text, NULL);
    page_set_theme(!strcmp(theme, "light"));
    cells_init(&grid, cols, rows);

    const bool headless = dump || ansi || keys;
    if (!headless) {
        const int status = interactive();
        cells_free(&grid);
        term_render_report();
        return status;
    }

    // headless: the base frame, then a frame after each key
    frame();
    if (keys) {
        char *copy = strdup(keys);
        for (char *k = strtok(copy, ","); k; k = strtok(NULL, ",")) {
            page_key(k);
            frame();
        }
        free(copy);
    }
    if (dump) {
        FILE *f = !strcmp(dump, "-") ? stdout : fopen(dump, "w");
        if (!f) {
            fprintf(stderr, "%s: %s\n", dump, strerror(errno));
            return 2;
        }
        cells_dump(&grid, f);
        if (f != stdout) fclose(f);
    }
    if (ansi) {
        FILE *f = !strcmp(ansi, "-") ? stdout : fopen(ansi, "wb");
        if (!f) {
            fprintf(stderr, "%s: %s\n", ansi, strerror(errno));
            return 2;
        }
        cells_ansi(&grid, f);
        if (f != stdout) fclose(f);
    }
    cells_free(&grid);
    term_render_report();
    return errors ? 1 : 0;
}
