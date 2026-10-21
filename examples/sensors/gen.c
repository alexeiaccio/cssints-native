// The Sensors page evaluated at build time from solid/app/Sensors.tsx (generator/page-to-c.ts) against the page written
// by hand (examples/sensors/page.c): Clay must give the same render commands, field by field. Six comparisons: the base
// state, the clicked one (use_g) and the pressed pill, each in the dark and the light theme. The generated C is
// compiled in, not read at run time: the test regenerates the .c files and compiles them here.
#define CLAY_IMPLEMENTATION
#include "styles.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// page_generated.c: use_g=false; page_generated_g.c: use_g=true; page_generated_pressed.c: the pointer over Units, held
void app_frame(void);
void app_frame_light(void);
void app_frame_g(void);
void app_frame_g_light(void);
void app_frame_pressed(void);
void app_frame_pressed_light(void);

#define MAX_COMMANDS 64

static const float ACCEL[3] = {1.159f, -0.718f, 10.044f}, GYRO[3] = {2.23f, 4.82f, 0.02f};

static Clay_String str(const char *s) { return (Clay_String){.length = (int32_t)strlen(s), .chars = s}; }

static void on_units(Clay_ElementId id, Clay_PointerData p, void *user)
{
    (void)id, (void)p, (void)user;
}

// examples/sensors/page.c's app_frame, with its two run-time inputs as arguments: the signal (use_g), the theme (light)
// and the pressed pointer (down, which page.c reads from Clay_PointerOver). The strings are the page's own.
#define T(name) (light ? name##_light : name)
static void hand(int use_g, int light, int down)
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

    CLAY(CLAY_ID("Root"), T(root)) {
        CLAY(CLAY_ID("Title"), {}) {
            CLAY_TEXT(CLAY_STRING("Sensors"), T(title_text));
        }
        CLAY_TEXT(str(label), T(caption_text));
        CLAY_TEXT(str(accel), T(value_text));
        CLAY_TEXT(CLAY_STRING("gyro \u00b0/s"), T(caption_text));
        CLAY_TEXT(str(gyro), T(value_text));
        CLAY_TEXT(str(mag), T(magnitude_text));
        CLAY(CLAY_ID("Units"), down ? T(units_active) : T(units)) {
            Clay_OnHover(on_units, NULL);
            CLAY_TEXT(str(use_g ? "switch to m/s\u00b2" : "switch to g"), T(unitsLabel_text));
        }
    }
}

// The same measure for both frames: the layout must be the comparison's, not the font's, so a fixed advance.
static Clay_Dimensions measure(Clay_StringSlice text, Clay_TextElementConfig *config, void *user)
{
    (void)user;
    return (Clay_Dimensions){.width = (float)text.length * (float)config->fontSize * 0.55f,
                             .height = (float)config->fontSize * 1.25f};
}

// ---------- field-by-field comparison, the way same.c compares one element

static int same_color(Clay_Color a, Clay_Color b)
{
    return a.r == b.r && a.g == b.g && a.b == b.b && a.a == b.a;
}
static int same_radius(Clay_CornerRadius a, Clay_CornerRadius b)
{
    return a.topLeft == b.topLeft && a.topRight == b.topRight && a.bottomRight == b.bottomRight &&
           a.bottomLeft == b.bottomLeft;
}
static int same_border(Clay_BorderWidth a, Clay_BorderWidth b)
{
    return a.left == b.left && a.right == b.right && a.top == b.top && a.bottom == b.bottom;
}
static int same_box(Clay_BoundingBox a, Clay_BoundingBox b)
{
    return a.x == b.x && a.y == b.y && a.width == b.width && a.height == b.height;
}

/** The name of the first field that differs, or NULL. Only the command types this page emits. */
static const char *difference(const Clay_RenderCommand *a, const Clay_RenderCommand *b)
{
    if (a->commandType != b->commandType) return "commandType";
    if (a->id != b->id) return "id";
    if (a->zIndex != b->zIndex) return "zIndex";
    if (!same_box(a->boundingBox, b->boundingBox)) return "boundingBox";
    switch (a->commandType) {
    case CLAY_RENDER_COMMAND_TYPE_RECTANGLE:
        if (!same_color(a->renderData.rectangle.backgroundColor, b->renderData.rectangle.backgroundColor))
            return "renderData.rectangle.backgroundColor";
        if (!same_radius(a->renderData.rectangle.cornerRadius, b->renderData.rectangle.cornerRadius))
            return "renderData.rectangle.cornerRadius";
        return NULL;
    case CLAY_RENDER_COMMAND_TYPE_BORDER:
        if (!same_color(a->renderData.border.color, b->renderData.border.color)) return "renderData.border.color";
        if (!same_radius(a->renderData.border.cornerRadius, b->renderData.border.cornerRadius))
            return "renderData.border.cornerRadius";
        if (!same_border(a->renderData.border.width, b->renderData.border.width)) return "renderData.border.width";
        return NULL;
    case CLAY_RENDER_COMMAND_TYPE_TEXT: {
        const Clay_TextRenderData *x = &a->renderData.text, *y = &b->renderData.text;
        if (!same_color(x->textColor, y->textColor)) return "renderData.text.textColor";
        if (x->fontId != y->fontId) return "renderData.text.fontId";
        if (x->fontSize != y->fontSize) return "renderData.text.fontSize";
        if (x->letterSpacing != y->letterSpacing) return "renderData.text.letterSpacing";
        if (x->lineHeight != y->lineHeight) return "renderData.text.lineHeight";
        if (x->stringContents.length != y->stringContents.length) return "renderData.text.stringContents.length";
        if (memcmp(x->stringContents.chars, y->stringContents.chars, (size_t)x->stringContents.length))
            return "renderData.text.stringContents.chars";
        return NULL;
    }
    default:
        // no other command type on this page; if one appears, the comparison above stops being a proof
        return "commandType not covered by this comparison";
    }
}

/** One generated frame against the hand-written page: the same commands, or the first difference printed. */
static int check(const char *what, void (*generated)(void), int use_g, int light, int down)
{
    Clay_RenderCommand gen[MAX_COMMANDS], manual[MAX_COMMANDS];
    Clay_BeginLayout();
    generated();
    Clay_RenderCommandArray g = Clay_EndLayout(0);
    if (g.length > MAX_COMMANDS) {
        printf("FAIL %s: %d commands, more than the %d kept\n", what, g.length, MAX_COMMANDS);
        return 0;
    }
    memcpy(gen, g.internalArray, (size_t)g.length * sizeof *gen);

    Clay_BeginLayout();
    hand(use_g, light, down);
    Clay_RenderCommandArray h = Clay_EndLayout(0);

    if (g.length != h.length) {
        printf("FAIL %s: %d generated commands, %d hand-written\n", what, g.length, h.length);
        return 0;
    }
    for (int i = 0; i < g.length; i++) {
        const char *d = difference(&gen[i], &h.internalArray[i]);
        if (d) {
            printf("FAIL %s: command %d (%d) differs at %s\n", what, i, (int)gen[i].commandType, d);
            return 0;
        }
    }
    printf("%s: %d commands, identical\n", what, g.length);
    return 1;
}

int main(void)
{
    uint32_t n = Clay_MinMemorySize();
    Clay_Initialize(Clay_CreateArenaWithCapacityAndMemory(n, malloc(n)), (Clay_Dimensions){360, 360},
                    (Clay_ErrorHandler){0});
    Clay_SetMeasureTextFunction(measure, NULL);
    int ok = 1;
    ok = check("dark, use_g=false", app_frame, 0, 0, 0) && ok;
    ok = check("light, use_g=false", app_frame_light, 0, 1, 0) && ok;
    ok = check("dark, use_g=true", app_frame_g, 1, 0, 0) && ok;
    ok = check("light, use_g=true", app_frame_g_light, 1, 1, 0) && ok;
    ok = check("dark, pressed", app_frame_pressed, 0, 0, 1) && ok;
    ok = check("light, pressed", app_frame_pressed_light, 0, 1, 1) && ok;
    if (!ok) return 1;
    puts("sensors generated page: the same render commands as the hand-written page");
    return 0;
}
