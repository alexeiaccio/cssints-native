// The screen stack: a small array of Page pointers, the top one taking every frame. Not a general router: the sky
// pages are the only users, and a screen is a const Page it exports.
#include <string.h>

#include "page.h"
#include "shell.h"

#define SHELL_MAX 8

static const Page *stack[SHELL_MAX] = {&SKY_PAGE};
static int depth = 1;

static const Page *top(void) { return stack[depth - 1]; }

static void shell_input(const TermEvent *ev)
{
    // the theme is the app's, not a screen's: `t` flips it on every sky screen (Sensors keeps its own)
    if (ev->key && !strcmp(ev->key, "t")) {
        sky_light = !sky_light;
        return;
    }
    if (top()->input) top()->input(ev);
}

static void shell_declare(void) { top()->declare(); }

static int shell_settled(void) { return top()->settled ? top()->settled() : 1; }

const Page SHELL_PAGE = {shell_input, shell_declare, shell_settled, shell_reset_top};

void shell_reset(const Page *root)
{
    depth = 0;
    stack[depth++] = root;
}

void shell_push(const Page *p)
{
    if (depth >= SHELL_MAX) return;
    stack[depth++] = p;
    if (p->reset) p->reset();
}

void shell_pop(void)
{
    if (depth > 1) depth--;
}

void shell_reset_top(void)
{
    if (top()->reset) top()->reset();
}
