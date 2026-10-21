// The Sensors page, styled by styles.ts (styles.h is generated) and fed a fixed sample, so a frame is reproducible.
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "styles.h"

static const float ACCEL[3] = {1.159f, -0.718f, 10.044f}, GYRO[3] = {2.23f, 4.82f, 0.02f};
static bool use_g;
// THEME=light picks the light theme, and the t key toggles it: styles.h has every style again as <name>_light
static int light = -1;
// IMAGE=1 adds the page's image (the 32x32 glyph of the picture above the caption): a frame of its own, so the stored
// frames of the plain page stay as they are. ThorVG loads its path; Clay's SDL3 renderer knows only SDL_Textures.
static int image_on = -1;
#define T(name) (light ? name##_light : name)

static void theme_init(void)
{
    if (light < 0) light = getenv("THEME") && !strcmp(getenv("THEME"), "light");
    if (image_on < 0) image_on = getenv("IMAGE") && strcmp(getenv("IMAGE"), "0");
}

static Clay_String str(const char *s) { return (Clay_String){.length = (int32_t)strlen(s), .chars = s}; }

static void on_units(Clay_ElementId id, Clay_PointerData p, void *user)
{
    (void)id, (void)user;
    if (p.state == CLAY_POINTER_DATA_PRESSED_THIS_FRAME) use_g = !use_g;
}

void app_key(int key)
{
    theme_init();
    if (key == 't') light = !light;
}

void app_frame(bool down)
{
    theme_init();
    const float scale = use_g ? 1.0f / 9.80665f : 1.0f;
    const char *unit = use_g ? "g" : "m/s\u00b2";
    // static: Clay reads the strings at the render pass, after this function returns
    static char label[24], accel[64], gyro[64], mag[32];
    snprintf(label, sizeof label, "accel %s", unit);
    snprintf(accel, sizeof accel, "%+.2f  %+.2f  %+.2f", ACCEL[0] * scale, ACCEL[1] * scale, ACCEL[2] * scale);
    snprintf(gyro, sizeof gyro, "%+.1f  %+.1f  %+.1f", GYRO[0], GYRO[1], GYRO[2]);
    const float a = sqrtf(ACCEL[0] * ACCEL[0] + ACCEL[1] * ACCEL[1] + ACCEL[2] * ACCEL[2]);
    snprintf(mag, sizeof mag, "|a| %.2f %s", a * scale, unit);

    CLAY(CLAY_ID("Root"), T(root)) {
        // The title in a box of its own: on the board a press on the "Title" id is the way home, and the page is the
        // same page on every target, so the box is here too (it draws nothing of itself).
        CLAY(CLAY_ID("Title"), {}) {
            CLAY_TEXT(CLAY_STRING("Sensors"), T(title_text));
        }
        // the IMAGE=1 variant: the page's own image, a leaf with its box from the style
        if (image_on) CLAY(CLAY_ID("Glyph"), T(glyph)) {}
        CLAY_TEXT(str(label), T(caption_text));
        CLAY_TEXT(str(accel), T(value_text));
        CLAY_TEXT(CLAY_STRING("gyro \u00b0/s"), T(caption_text));
        CLAY_TEXT(str(gyro), T(value_text));
        CLAY_TEXT(str(mag), T(magnitude_text));
        // Clay has no states: hover and the pressed look are units_hover and units_active, picked here
        const bool over = Clay_PointerOver(CLAY_ID("Units"));
        const bool pressed = down && over;
        CLAY(CLAY_ID("Units"), pressed ? T(units_active) : over ? T(units_hover) : T(units)) {
            Clay_OnHover(on_units, NULL);
            CLAY_TEXT(str(use_g ? "switch to m/s\u00b2" : "switch to g"), T(unitsLabel_text));
        }
    }
}
