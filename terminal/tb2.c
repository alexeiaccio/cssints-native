// termbox2 (vendor/termbox2.h, MIT) as the terminal's backend. 32-bit attributes are compiled in so a 24-bit colour
// fits; which mode is used is decided once, at open.
#include <ctype.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <strings.h>
#include <sys/select.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>

#define TB_OPT_ATTR_W 32
#define TB_IMPL
#include "termbox2.h"

#include "tb2.h"

static int truecolor;
static int started;
static int last_error;

// The terminal's word for it: COLORTERM is what iTerm2, Ghostty, kitty, WezTerm and the rest set; a TERM of
// "xterm-direct" or "*-truecolor" is the other spelling. Nothing else can be asked, and termbox2 says so too.
static int detect_truecolor(void)
{
    const char *ct = getenv("COLORTERM");
    if (ct && (strcasestr(ct, "truecolor") || strcasestr(ct, "24bit"))) return 1;
    const char *term = getenv("TERM");
    return term && (strstr(term, "direct") || strcasestr(term, "truecolor"));
}

// The xterm-256 index nearest an RGB triple: the 6x6x6 cube (16..231) against the 24-step grey ramp (232..255),
// whichever is closer. A cell keeps its exact RGB in the truecolour path; this is only the fallback.
static int nearest256(const CellRGB *p)
{
    static const int LEVEL[6] = {0, 95, 135, 175, 215, 255};
    int best[3] = {0, 0, 0};
    const int v[3] = {p->r, p->g, p->b};
    for (int c = 0; c < 3; c++) {
        int bestd = 1 << 30;
        for (int i = 0; i < 6; i++) {
            const int d = v[c] - LEVEL[i];
            if (d * d < bestd) bestd = d * d, best[c] = i;
        }
    }
    const int cube = 16 + 36 * best[0] + 6 * best[1] + best[2];
    const int cr = LEVEL[best[0]], cg = LEVEL[best[1]], cb = LEVEL[best[2]];
    const int cubed = (v[0] - cr) * (v[0] - cr) + (v[1] - cg) * (v[1] - cg) + (v[2] - cb) * (v[2] - cb);
    // the ramp steps are 8 + 10i, so the nearest step is round((mean - 8) / 10)
    int step = (((v[0] + v[1] + v[2]) / 3) - 8 + 5) / 10;
    if (step < 0) step = 0;
    if (step > 23) step = 23;
    const int g = 8 + 10 * step;
    const int grayd = (v[0] - g) * (v[0] - g) + (v[1] - g) * (v[1] - g) + (v[2] - g) * (v[2] - g);
    return grayd < cubed ? 232 + step : cube;
}

static uintattr_t fg_color(const Cells *g, uint8_t i)
{
    const CellRGB *p = &g->palette[i];
    if (truecolor) {
        const uintattr_t v = ((uintattr_t)p->r << 16) | ((uintattr_t)p->g << 8) | p->b;
        return v ? v : TB_HI_BLACK; // 0x000000 is TB_DEFAULT in this mode, so the one real black is HI_BLACK
    }
    const int n = nearest256(p);
    return n ? (uintattr_t)n : TB_HI_BLACK;
}

int term_tb2_open(int *cols, int *rows, Tb2Colors colors)
{
    const int rv = tb_init(); // /dev/tty: the terminal, whatever stdout is
    if (rv != TB_OK) {
        last_error = rv;
        return rv;
    }
    started = 1;
    truecolor = colors == TB2_COLORS_TRUECOLOR || (colors == TB2_COLORS_AUTO && detect_truecolor());
    tb_set_output_mode(truecolor ? TB_OUTPUT_TRUECOLOR : TB_OUTPUT_256);
    tb_set_input_mode(TB_INPUT_ESC | TB_INPUT_MOUSE);
    tb_hide_cursor();
    term_tb2_size(cols, rows);
    return 0;
}

void term_tb2_size(int *cols, int *rows)
{
    *cols = tb_width() > 0 ? tb_width() : 80;
    *rows = tb_height() > 0 ? tb_height() : 24;
}

int term_tb2_truecolor(void) { return truecolor; }

void term_tb2_present(const Cells *g)
{
    if (!started) return;
    for (int y = 0; y < g->rows && y < tb_height(); y++)
        for (int x = 0; x < g->cols && x < tb_width(); x++) {
            const Cell *c = &g->cells[y * g->cols + x];
            uint32_t ch = ' ';
            if (c->bytes[0]) tb_utf8_char_to_unicode(&ch, c->bytes);
            tb_set_cell(x, y, ch, fg_color(g, c->fg), fg_color(g, c->bg));
        }
    tb_present();
}

// One termbox2 event as a TermEvent: a key name the desktop's focus manager uses, or the pointer in cells.
static const char *key_of(const struct tb_event *e, char *one)
{
    static const struct {
        int key;
        const char *name;
    } KEYS[] = {
        {TB_KEY_ARROW_UP, "ArrowUp"},     {TB_KEY_ARROW_DOWN, "ArrowDown"},
        {TB_KEY_ARROW_LEFT, "ArrowLeft"}, {TB_KEY_ARROW_RIGHT, "ArrowRight"},
        {TB_KEY_HOME, "Home"},            {TB_KEY_END, "End"},
        {TB_KEY_PGUP, "PageUp"},          {TB_KEY_PGDN, "PageDown"},
        {TB_KEY_BACKSPACE, "Backspace"},  {TB_KEY_BACKSPACE2, "Backspace"},
        {TB_KEY_ENTER, "Enter"},          {TB_KEY_ESC, "Escape"},
        {TB_KEY_SPACE, "Space"},          {TB_KEY_CTRL_C, "Ctrl+C"},
        {TB_KEY_MOUSE_WHEEL_UP, "WheelUp"}, {TB_KEY_MOUSE_WHEEL_DOWN, "WheelDown"},
    };
    if (e->key == TB_KEY_TAB || e->key == TB_KEY_BACK_TAB) return e->mod & TB_MOD_SHIFT ? "Shift+Tab" : "Tab";
    for (size_t i = 0; i < sizeof KEYS / sizeof *KEYS; i++)
        if (KEYS[i].key == e->key) return KEYS[i].name;
    if (!e->ch || e->ch > 0x7e) return NULL;
    one[0] = (char)e->ch;
    one[1] = 0;
    return one;
}

Tb2Status term_tb2_poll(TermEvent *ev) { return term_tb2_poll_ms(ev, -1); }

Tb2Status term_tb2_poll_ms(TermEvent *ev, int ms)
{
    if (!started) return TB2_QUIT;
    struct tb_event e;
    const int rv = ms < 0 ? tb_poll_event(&e) : tb_peek_event(&e, ms);
    if (rv == TB_ERR_NO_EVENT) return TB2_NONE;
    if (rv != TB_OK) return TB2_QUIT;
    ev->key = NULL;
    ev->down = ev->up = 0;
    ev->px = ev->py = -1;
    switch (e.type) {
    case TB_EVENT_RESIZE: return TB2_RESIZE;
    case TB_EVENT_MOUSE:
        ev->px = e.x;
        ev->py = e.y;
        if (e.key == TB_KEY_MOUSE_LEFT) ev->down = 1;
        else if (e.key == TB_KEY_MOUSE_RELEASE) ev->up = 1;
        else if (e.key == TB_KEY_MOUSE_WHEEL_UP) ev->key = "WheelUp";
        else if (e.key == TB_KEY_MOUSE_WHEEL_DOWN) ev->key = "WheelDown";
        return TB2_EVENT;
    case TB_EVENT_KEY: {
        static char one[2];
        ev->key = key_of(&e, one);
        return ev->key ? TB2_EVENT : TB2_NONE;
    }
    default: return TB2_NONE;
    }
}

void term_tb2_close(void)
{
    if (!started) return;
    started = 0;
    tb_shutdown();
}

const char *term_tb2_error(void) { return tb_strerror(last_error); }

// How long the terminal is given to answer the colour query (OSC 10, 11, 4 and CSI ? 996 n, from @cssints/tui/system's
// QUERY) before the host falls back: an answering terminal is a couple of ms, a silent one is this cost once.
#define ASK_QUIET_MS 15

int term_tb2_ask(const char *query, char *out, int cap, int ms)
{
    if (!out || cap < 2 || !query) return 0;
    out[0] = 0;
    // the terminal itself, not stdin: a host whose stdout is a file or a pipe still has a /dev/tty (no controlling
    // terminal at all -- a dumb pipe, CI without a pty -- leaves the answer at 0 and the caller at its fallback)
    const int fd = open("/dev/tty", O_RDWR | O_NOCTTY | O_NONBLOCK); // non-blocking: a read after select cannot block
    if (fd < 0) return 0;
    struct termios saved, raw;
    const int have = tcgetattr(fd, &saved) == 0;
    if (have) {
        raw = saved;
        cfmakeraw(&raw); // no echo, no line discipline: a reply is ESC ] ... BEL/ST, and it must not be echoed
        raw.c_cc[VMIN] = 1;
        raw.c_cc[VTIME] = 0;
        tcsetattr(fd, TCSANOW, &raw);
    }
    size_t off = 0;
    const size_t qlen = strlen(query);
    while (off < qlen) {
        const ssize_t n = write(fd, query + off, qlen - off);
        if (n <= 0) break;
        off += (size_t)n;
    }
    int len = 0;
    struct timespec start;
    clock_gettime(CLOCK_MONOTONIC, &start);
    for (;;) {
        // the first byte waits up to `ms`; once an answer starts arriving, a quiet gap ends the read (the 16 OSC 4
        // answers can come in one write or several, and the host should not spend the whole timeout on a success)
        int wait = len > 0 ? ASK_QUIET_MS : ms;
        if (ms >= 0) {
            struct timespec now;
            clock_gettime(CLOCK_MONOTONIC, &now);
            const long spent = (now.tv_sec - start.tv_sec) * 1000 + (now.tv_nsec - start.tv_nsec) / 1000000;
            const long left = ms - spent;
            if (wait > left) wait = (int)left;
            if (wait <= 0) break;
        }
        struct timeval tv = {.tv_sec = wait / 1000, .tv_usec = (wait % 1000) * 1000};
        fd_set readable;
        FD_ZERO(&readable);
        FD_SET(fd, &readable);
        // select, not poll: poll on this tty fd reports POLLNVAL (0x20) while the read has data, so it cannot be the
        // wait; select's 0 is the timeout and its ready set is the reply
        if (select(fd + 1, &readable, NULL, NULL, wait < 0 ? NULL : &tv) <= 0) break;
        const ssize_t n = read(fd, out + len, (size_t)(cap - 1 - len));
        if (n <= 0) break;
        len += (int)n;
        if (len >= cap - 1) break;
    }
    out[len] = 0;
    if (have) tcsetattr(fd, TCSANOW, &saved);
    close(fd);
    return len;
}
