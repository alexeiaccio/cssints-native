// The Sensors page in cells: the same styles.h as the desktop (examples/sensors/styles.ts), read through the
// terminal's measure, plus a list of readings under it. Text, a filled pill with a border, a selected row and a
// focus ring are the states the renderer has to prove.
//
// Two lengths are re-cut for cells, and only these: the root's padding and gap, and the pill's height. A style in
// pixels does not land on a cell boundary (40px is 2.5 rows, 38px is 2.4), and a box that is not a whole number of
// cells cannot hold a top border, a line of text and a bottom border. Everything else is the desktop's declaration.
//
// Keys (the names the desktop's focus manager uses): Tab moves between the pill and the list, Up/Down move the
// selection, Space/Enter toggle the unit or mark a row, t flips the theme (THEME=light starts there).
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cells.h"
#include "page.h"
#include "styles.h"

static const float ACCEL[3] = {1.159f, -0.718f, 10.044f}, GYRO[3] = {2.23f, 4.82f, 0.02f};
static const char *const READINGS[4] = {"accel", "gyro", "magnetometer", "temperature"};

static bool use_g;
static int light = -1; // -1: not read yet
static int focus;      // 0 the Units pill, 1 the list
static int sel, picked = -1;
#define T(name) (light ? name##_light : name)

static void theme_init(void)
{
    if (light < 0) light = getenv("THEME") && !strcmp(getenv("THEME"), "light");
}

static Clay_String str(const char *s) { return (Clay_String){.length = (int32_t)strlen(s), .chars = s}; }

// The page: the desktop's root with a cell-aligned rhythm (2 rows of padding, no gap: a gap shorter than a line is
// a row nothing draws in).
static Clay_ElementDeclaration root_style(void)
{
    Clay_ElementDeclaration d = T(root);
    d.layout.padding = (Clay_Padding){.left = 2 * CELL_W, .right = 2 * CELL_W, .top = 2 * CELL_H, .bottom = 2 * CELL_H};
    d.layout.childGap = 0;
    return d;
}

// The pill, 3 cells tall so its border, its centred label and its border are three rows; the accent border is the
// focus ring when the pill has focus.
static Clay_ElementDeclaration pill_style(bool focused)
{
    Clay_ElementDeclaration d = T(units);
    d.layout.sizing.height = CLAY_SIZING_FIXED(3 * CELL_H);
    if (focused)
        d.border = (Clay_BorderElementConfig){.color = T(magnitude_text).textColor, .width = {1, 1, 1, 1}};
    return d;
}

// The list's frame: a cell of padding so the ring has rows of its own, and the accent ring while the list has focus.
static Clay_ElementDeclaration list_style(bool focused)
{
    Clay_ElementDeclaration d = {0};
    d.layout.sizing.width = CLAY_SIZING_FIXED(50 * CELL_W);
    d.layout.sizing.height = CLAY_SIZING_FIT(0);
    d.layout.padding = (Clay_Padding){.left = CELL_W, .right = CELL_W, .top = CELL_H, .bottom = CELL_H};
    d.layout.layoutDirection = CLAY_TOP_TO_BOTTOM;
    if (focused)
        d.border = (Clay_BorderElementConfig){.color = T(magnitude_text).textColor, .width = {1, 1, 1, 1}};
    return d;
}

// A row: one cell tall, the selected one on the panel's surface, one cell of padding either side.
static Clay_ElementDeclaration row_style(bool selected)
{
    Clay_ElementDeclaration d = {0};
    d.layout.sizing.width = CLAY_SIZING_GROW(0);
    d.layout.sizing.height = CLAY_SIZING_FIXED(CELL_H);
    d.layout.padding = (Clay_Padding){.left = CELL_W, .right = CELL_W};
    d.layout.childGap = CELL_W;
    d.layout.layoutDirection = CLAY_LEFT_TO_RIGHT;
    d.layout.childAlignment = (Clay_ChildAlignment){.y = CLAY_ALIGN_Y_CENTER};
    if (selected) d.backgroundColor = T(units).backgroundColor;
    return d;
}

// The keys page.c answers: the names the desktop's focus manager uses, applied before the frame that shows them.
void sensors_input(const TermEvent *ev)
{
    const char *name = ev->key;
    theme_init();
    if (!name) return;
    if (!strcmp(name, "t")) {
        light = !light;
    } else if (!strcmp(name, "Tab") || !strcmp(name, "Shift+Tab")) {
        focus = !focus;
    } else if (!strcmp(name, "ArrowDown") || !strcmp(name, "ArrowUp")) {
        focus = 1;
        sel += !strcmp(name, "ArrowDown") ? 1 : -1;
        if (sel < 0) sel = 0;
        if (sel > 3) sel = 3;
    } else if (!strcmp(name, "Space") || !strcmp(name, "Enter")) {
        if (focus == 0) use_g = !use_g;
        else picked = sel;
    }
}

void page_set_theme(int l)
{
    light = l;
}

void sensors_declare(void)
{
    theme_init();
    const float scale = use_g ? 1.0f / 9.80665f : 1.0f;
    const char *unit = use_g ? "g" : "m/s\u00b2";
    // static: Clay reads the strings at the render pass, after this function returns
    static char label[24], accel[64], gyro[64], mag[32], rows[4][32];
    snprintf(label, sizeof label, "accel %s", unit);
    snprintf(accel, sizeof accel, "%+.2f  %+.2f  %+.2f", ACCEL[0] * scale, ACCEL[1] * scale, ACCEL[2] * scale);
    snprintf(gyro, sizeof gyro, "%+.1f  %+.1f  %+.1f", GYRO[0], GYRO[1], GYRO[2]);
    const float a = sqrtf(ACCEL[0] * ACCEL[0] + ACCEL[1] * ACCEL[1] + ACCEL[2] * ACCEL[2]);
    snprintf(mag, sizeof mag, "|a| %.2f %s", a * scale, unit);
    for (int i = 0; i < 4; i++) snprintf(rows[i], sizeof rows[i], "%s %s", i == sel ? ">" : " ", READINGS[i]);

    CLAY(CLAY_ID("Root"), root_style()) {
        CLAY_TEXT(CLAY_STRING("Sensors"), T(title_text));
        CLAY_TEXT(str(label), T(caption_text));
        CLAY_TEXT(str(accel), T(value_text));
        CLAY_TEXT(CLAY_STRING("gyro \u00b0/s"), T(caption_text));
        CLAY_TEXT(str(gyro), T(value_text));
        CLAY_TEXT(str(mag), T(magnitude_text));
        CLAY(CLAY_ID("Units"), pill_style(focus == 0)) {
            CLAY_TEXT(str(use_g ? "switch to m/s\u00b2" : "switch to g"), T(unitsLabel_text));
        }
        CLAY(CLAY_ID("List"), list_style(focus == 1)) {
            for (int i = 0; i < 4; i++) {
                CLAY(CLAY_IDI("Row", i), row_style(i == sel)) {
                    CLAY_TEXT(str(rows[i]), picked == i ? T(magnitude_text) : T(value_text));
                }
            }
        }
        CLAY_TEXT(CLAY_STRING("Tab focus  Up/Down select  Space activate  t theme"), T(caption_text));
    }
}

const Page SENSORS_PAGE = {sensors_input, sensors_declare, NULL};
