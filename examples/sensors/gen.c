// The Sensors page evaluated at build time from solid/app/Sensors.tsx (generator/page-to-c.ts) against the page written
// by hand (examples/sensors/page.c): Clay must give the same render commands, field by field.
//
// Two things are compared:
//   — the four single-state files (page_generated.c, page_generated_g.c, page_generated_pressed.c and
//     page_generated_image.c) with the hand page at that state, in the dark and the light theme (the six comparisons
//     this file always made, and the image's two);
//   — the *state machine* (page_generated_events.c): a sequence of a click on Units and the click after it, its state
//     asked of `sensors_next` at every edge and its frame drawn through `sensors_frame`, against the hand page at the
//     same place — so the table is held to the page's own behaviour, not to itself.
#define CLAY_IMPLEMENTATION
#include "events.h"
#include "styles.h"

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// page_generated.c: use_g=false; page_generated_g.c: use_g=true; page_generated_pressed.c: the pointer over Units, held;
// page_generated_image.c: the IMAGE=1 variant, the page's 32x32 glyph under the title (a prop of the Solid page)
void app_frame(void);
void app_frame_light(void);
void app_frame_g(void);
void app_frame_g_light(void);
void app_frame_pressed(void);
void app_frame_pressed_light(void);
void app_frame_image(void);
void app_frame_image_light(void);

// page_generated_events.c: the same page as a state machine, the frames through `sensors_frame(state, light)`
int sensors_state_count(void);
const char *sensors_state_name(int state);
int sensors_next(int state, uint32_t id, int event);
void sensors_frame(int state, int light);

#define MAX_COMMANDS 64

static const float ACCEL[3] = {1.159f, -0.718f, 10.044f}, GYRO[3] = {2.23f, 4.82f, 0.02f};

static Clay_String str(const char *s) { return (Clay_String){.length = (int32_t)strlen(s), .chars = s}; }

static void on_units(Clay_ElementId id, Clay_PointerData p, void *user)
{
    (void)id, (void)p, (void)user;
}

// examples/sensors/page.c's app_frame, with its run-time inputs as arguments: the signal (use_g), the theme (light),
// the pointer on the pill (over), the button (down, which page.c reads from Clay_PointerOver) and the IMAGE=1 variant
// (image, page.c's getenv). The strings are the page's own.
#define T(name) (light ? name##_light : name)
static void hand(int use_g, int light, int down, int over, int image)
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
        // page.c: if (image_on) CLAY(CLAY_ID("Glyph"), T(glyph)) {}
        if (image) CLAY(CLAY_ID("Glyph"), T(glyph)) {}
        CLAY_TEXT(str(label), T(caption_text));
        CLAY_TEXT(str(accel), T(value_text));
        CLAY_TEXT(CLAY_STRING("gyro \u00b0/s"), T(caption_text));
        CLAY_TEXT(str(gyro), T(value_text));
        CLAY_TEXT(str(mag), T(magnitude_text));
        // page.c: pressed ? units_active : over ? units_hover : units
        CLAY(CLAY_ID("Units"), down ? T(units_active) : over ? T(units_hover) : T(units)) {
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

/** A command type's name, for the message: the types this page's two variants emit. */
static const char *kind(int t)
{
    switch (t) {
    case CLAY_RENDER_COMMAND_TYPE_RECTANGLE: return "rectangle";
    case CLAY_RENDER_COMMAND_TYPE_BORDER: return "border";
    case CLAY_RENDER_COMMAND_TYPE_TEXT: return "text";
    case CLAY_RENDER_COMMAND_TYPE_IMAGE: return "image";
    case CLAY_RENDER_COMMAND_TYPE_SCISSOR_START: return "clip";
    case CLAY_RENDER_COMMAND_TYPE_SCISSOR_END: return "clip end";
    default: return "?";
    }
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
    case CLAY_RENDER_COMMAND_TYPE_IMAGE: {
        const Clay_ImageRenderData *x = &a->renderData.image, *y = &b->renderData.image;
        if (!same_color(x->backgroundColor, y->backgroundColor)) return "renderData.image.backgroundColor";
        if (!same_radius(x->cornerRadius, y->cornerRadius)) return "renderData.image.cornerRadius";
        // the path: Clay passes imageData through untouched, so the two styles' literals must be the same bytes
        const char *px = x->imageData, *py = y->imageData;
        if (px || py) {
            if (!px || !py) return "renderData.image.imageData";
            if (strcmp(px, py)) return "renderData.image.imageData (path)";
        }
        return NULL;
    }
    default:
        // no other command type on this page; if one appears, the comparison above stops being a proof
        return "commandType not covered by this comparison";
    }
}

/** One generated frame against the hand-written page: the same commands, or the first difference printed. */
static int check(const char *what, void (*generated)(void), int use_g, int light, int down, int image)
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
    hand(use_g, light, down, 0, image);
    Clay_RenderCommandArray h = Clay_EndLayout(0);

    if (g.length != h.length) {
        printf("FAIL %s: %d generated commands, %d hand-written\n", what, g.length, h.length);
        return 0;
    }
    for (int i = 0; i < g.length; i++) {
        const char *d = difference(&gen[i], &h.internalArray[i]);
        if (d) {
            printf("FAIL %s: command %d (%s) differs at %s\n", what, i, kind(gen[i].commandType), d);
            return 0;
        }
    }
    printf("%s: %d commands, identical\n", what, g.length);
    return 1;
}

/** One step of the state machine: its frame against the hand page at the same signals, pointer and button. */
static int check_step(int step, int state, int use_g, int down, int over)
{
    Clay_RenderCommand gen[MAX_COMMANDS];
    Clay_BeginLayout();
    sensors_frame(state, 0);
    Clay_RenderCommandArray g = Clay_EndLayout(0);
    if (g.length > MAX_COMMANDS) {
        printf("FAIL step %d: %d commands, more than the %d kept\n", step, g.length, MAX_COMMANDS);
        return 0;
    }
    memcpy(gen, g.internalArray, (size_t)g.length * sizeof *gen);

    Clay_BeginLayout();
    hand(use_g, 0, down, over, 0);
    Clay_RenderCommandArray h = Clay_EndLayout(0);
    const char *name = sensors_state_name(state);

    if (g.length != h.length) {
        printf("FAIL step %d: %d generated commands, %d hand-written (state %d \"%s\")\n", step, g.length, h.length,
               state, name);
        return 0;
    }
    for (int i = 0; i < g.length; i++) {
        const char *d = difference(&gen[i], &h.internalArray[i]);
        if (d) {
            printf("FAIL step %d: command %d (%s) differs at %s (state %d \"%s\")\n", step, i, kind(gen[i].commandType),
                   d, state, name);
            return 0;
        }
    }
    printf("step %d: state %d \"%s\": %d commands, identical\n", step, state, name, g.length);
    return 1;
}

int main(void)
{
    uint32_t n = Clay_MinMemorySize();
    Clay_Initialize(Clay_CreateArenaWithCapacityAndMemory(n, malloc(n)), (Clay_Dimensions){360, 360},
                    (Clay_ErrorHandler){0});
    Clay_SetMeasureTextFunction(measure, NULL);
    int ok = 1;
    // the six frames the three files hold: the page at rest, after the click, and held, each dark and light
    ok = check("dark, use_g=false", app_frame, 0, 0, 0, 0) && ok;
    ok = check("light, use_g=false", app_frame_light, 0, 1, 0, 0) && ok;
    ok = check("dark, use_g=true", app_frame_g, 1, 0, 0, 0) && ok;
    ok = check("light, use_g=true", app_frame_g_light, 1, 1, 0, 0) && ok;
    ok = check("dark, pressed", app_frame_pressed, 0, 0, 1, 0) && ok;
    ok = check("light, pressed", app_frame_pressed_light, 0, 1, 1, 0) && ok;
    // the IMAGE=1 variant: the same page with the 32x32 glyph, the image command's type, id, box and path too
    const int images = check("dark, image", app_frame_image, 0, 0, 0, 1) +
                       check("light, image", app_frame_image_light, 0, 1, 0, 1);
    ok = images == 2 && ok;
    if (images == 2) puts("2 images, identical");
    else printf("FAIL: %d of the 2 image frames are identical\n", images);

    // the state machine, from the table: base -> press -> release -> press -> release
    printf("states: %d\n", sensors_state_count());
    for (int i = 0; i < sensors_state_count(); i++) printf("  %d \"%s\"\n", i, sensors_state_name(i));
    const uint32_t units = CLAY_ID("Units").id;
    int state = 0, step = 0;
    ok = check_step(step++, state, 0, 0, 0) && ok;
    state = sensors_next(state, units, CLAY_EVENT_PRESS);
    ok = check_step(step++, state, 0, 1, 1) && ok;
    state = sensors_next(state, units, CLAY_EVENT_RELEASE);
    ok = check_step(step++, state, 1, 0, 1) && ok;
    state = sensors_next(state, units, CLAY_EVENT_PRESS);
    ok = check_step(step++, state, 1, 1, 1) && ok;
    state = sensors_next(state, units, CLAY_EVENT_RELEASE);
    ok = check_step(step++, state, 0, 0, 1) && ok;
    // the second click came back to the page before the first, with the pointer still over the pill
    if (state != 1) {
        printf("FAIL: the second release is state %d, wanted 1 (\"%s\")\n", state, sensors_state_name(1));
        ok = 0;
    }
    if (!ok) return 1;
    puts("sensors generated page: the same render commands as the hand-written page, and a click on Units is a state");
    return 0;
}
