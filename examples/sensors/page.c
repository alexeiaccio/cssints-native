// The Sensors page, styled by styles.ts (styles.h is generated) and fed a fixed sample, so a frame is reproducible.
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "styles.h"

static const float ACCEL[3] = {1.159f, -0.718f, 10.044f}, GYRO[3] = {2.23f, 4.82f, 0.02f};
static bool use_g;

static Clay_String str(const char *s) { return (Clay_String){.length = (int32_t)strlen(s), .chars = s}; }

static void on_units(Clay_ElementId id, Clay_PointerData p, void *user)
{
    (void)id, (void)user;
    if (p.state == CLAY_POINTER_DATA_PRESSED_THIS_FRAME) use_g = !use_g;
}

void app_frame(bool down)
{
    const float scale = use_g ? 1.0f / 9.80665f : 1.0f;
    const char *unit = use_g ? "g" : "m/s\u00b2";
    // static: Clay reads the strings at the render pass, after this function returns
    static char label[24], accel[64], gyro[64], mag[32];
    snprintf(label, sizeof label, "accel %s", unit);
    snprintf(accel, sizeof accel, "%+.2f  %+.2f  %+.2f", ACCEL[0] * scale, ACCEL[1] * scale, ACCEL[2] * scale);
    snprintf(gyro, sizeof gyro, "%+.1f  %+.1f  %+.1f", GYRO[0], GYRO[1], GYRO[2]);
    const float a = sqrtf(ACCEL[0] * ACCEL[0] + ACCEL[1] * ACCEL[1] + ACCEL[2] * ACCEL[2]);
    snprintf(mag, sizeof mag, "|a| %.2f %s", a * scale, unit);

    CLAY(CLAY_ID("Root"), root) {
        CLAY_TEXT(CLAY_STRING("Sensors"), title_text);
        CLAY_TEXT(str(label), caption_text);
        CLAY_TEXT(str(accel), value_text);
        CLAY_TEXT(CLAY_STRING("gyro \u00b0/s"), caption_text);
        CLAY_TEXT(str(gyro), value_text);
        CLAY_TEXT(str(mag), magnitude_text);
        // the pressed look is a style of its own; the frame picks it
        Clay_ElementDeclaration pill = units;
        if (down && Clay_PointerOver(CLAY_ID("Units"))) pill.backgroundColor = unitsDown.backgroundColor;
        CLAY(CLAY_ID("Units"), pill) {
            Clay_OnHover(on_units, NULL);
            CLAY_TEXT(str(use_g ? "switch to m/s\u00b2" : "switch to g"), unitsLabel_text);
        }
    }
}
