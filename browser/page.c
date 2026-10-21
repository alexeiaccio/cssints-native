// The browser target: Clay + the Sensors page that generator/page-to-c.ts emitted to C, compiled to WebAssembly.
// No JS at run time: the page is the static generated C, and frame(0)/frame(1) pick the base or the use_g frame.
//
// Text measurement is the one thing Clay cannot do without a font, and the page draws its text with Canvas2D. So the
// measure callback calls into JS (env.measure), which measures with the same font the canvas draws with, and writes
// the width and the height back into measure_slot(). The layout is therefore the browser's own font metrics, not a
// table copied from another raster.
//
// ABI (all ints and floats are 32-bit, little endian, in the wasm's linear memory):
//   init(width, height)      Clay's arena and layout dimensions; call once
//   frame(use_g)             0 draws page_generated.c's app_frame, 1 draws app_frame_g; then the command array
//   cmd_count()              commands in the last frame
//   cmd_size()               bytes per command record (19 int32/float slots, 76 bytes)
//   cmds()                   address of the first command record
//   text(ptr, len)           the text bytes are in the same linear memory: (ptr, len) in slots 15, 16
//   measure_slot()           float[2] the JS measure callback writes (width, height)
//   errors()                 Clay errors since init
// A record is 19 32-bit slots: type, id, x, y, w, h, color (r<<16 | g<<8 | b | a<<24),
//                             radius tl, tr, br, bl, border l, r, t, b, text ptr, text len, font id, font size.
#define CLAY_IMPLEMENTATION
#include "clay.h"

#include <stdint.h>
#include <stdlib.h>

#include "styles.h"

// the generated frames: page_generated.c (use_g=false) and page_generated_g.c (use_g=true)
void app_frame(void);
void app_frame_g(void);

// Canvas2D's measureText, in render.js: (chars, length, font id, font size), width and height into measure_slot()
extern void measure_text(const char *chars, int length, int fontId, int fontSize)
    __attribute__((import_module("env"), import_name("measure")));

typedef struct {
    int32_t type, id;
    float x, y, w, h;
    uint32_t color;
    float radius[4];
    float border[4];
    uint32_t text, textLength;
    int32_t fontId, fontSize;
} WebCommand;

#define MAX_COMMANDS 64
static WebCommand commands[MAX_COMMANDS];
static int32_t commandCount;
static uint32_t clayErrors;
static Clay_Dimensions layoutSize;
static char *arena; // Clay_MinMemorySize() bytes, from malloc: ~5.8 MB here, more than a static array should cost
static float measureSlot[2];

static void on_error(Clay_ErrorData e)
{
    (void)e;
    clayErrors++;
}

static Clay_Dimensions measure(Clay_StringSlice text, Clay_TextElementConfig *config, void *user)
{
    (void)user;
    const int size = config->fontSize ? config->fontSize : 14;
    measure_text(text.chars, text.length, config->fontId, size);
    return (Clay_Dimensions){measureSlot[0], config->lineHeight ? (float)config->lineHeight : measureSlot[1]};
}

/**
 * Colours arrive as 0-255 floats (cssints/clay prints the style's 0-255 channels into Clay's float fields, and both
 * desktop rasterisers pass them straight through); one int32 is r<<16 | g<<8 | b | a<<24 for JS's "#rrggbb".
 */
static uint32_t channel(float v)
{
    return v <= 0 ? 0 : v >= 255 ? 255 : (uint32_t)(v + 0.5f);
}
static uint32_t pack(Clay_Color c)
{
    return channel(c.r) << 16 | channel(c.g) << 8 | channel(c.b) | channel(c.a) << 24;
}

__attribute__((export_name("init"))) void page_init(int32_t width, int32_t height)
{
    layoutSize = (Clay_Dimensions){(float)width, (float)height};
    const uint32_t needed = Clay_MinMemorySize();
    arena = malloc(needed);
    if (!arena) {
        clayErrors++;
        return;
    }
    Clay_Initialize(Clay_CreateArenaWithCapacityAndMemory(needed, arena), layoutSize, (Clay_ErrorHandler){on_error, 0});
    Clay_SetMeasureTextFunction(measure, 0);
}

__attribute__((export_name("frame"))) void page_frame(int32_t useG)
{
    Clay_SetLayoutDimensions(layoutSize);
    Clay_BeginLayout();
    if (useG) app_frame_g();
    else app_frame();
    Clay_RenderCommandArray array = Clay_EndLayout(1.0f / 60.0f);

    commandCount = 0;
    for (int32_t i = 0; i < array.length && commandCount < MAX_COMMANDS; i++) {
        const Clay_RenderCommand *rc = Clay_RenderCommandArray_Get(&array, i);
        WebCommand *c = &commands[commandCount++];
        c->type = (int32_t)rc->commandType;
        c->id = (int32_t)rc->id;
        c->x = rc->boundingBox.x, c->y = rc->boundingBox.y;
        c->w = rc->boundingBox.width, c->h = rc->boundingBox.height;
        c->color = 0;
        for (int k = 0; k < 4; k++) c->radius[k] = 0, c->border[k] = 0;
        c->text = 0, c->textLength = 0, c->fontId = 0, c->fontSize = 0;
        switch (rc->commandType) {
        case CLAY_RENDER_COMMAND_TYPE_RECTANGLE:
            c->color = pack(rc->renderData.rectangle.backgroundColor);
            c->radius[0] = rc->renderData.rectangle.cornerRadius.topLeft;
            c->radius[1] = rc->renderData.rectangle.cornerRadius.topRight;
            c->radius[2] = rc->renderData.rectangle.cornerRadius.bottomRight;
            c->radius[3] = rc->renderData.rectangle.cornerRadius.bottomLeft;
            break;
        case CLAY_RENDER_COMMAND_TYPE_BORDER:
            c->color = pack(rc->renderData.border.color);
            c->radius[0] = rc->renderData.border.cornerRadius.topLeft;
            c->radius[1] = rc->renderData.border.cornerRadius.topRight;
            c->radius[2] = rc->renderData.border.cornerRadius.bottomRight;
            c->radius[3] = rc->renderData.border.cornerRadius.bottomLeft;
            c->border[0] = rc->renderData.border.width.left;
            c->border[1] = rc->renderData.border.width.right;
            c->border[2] = rc->renderData.border.width.top;
            c->border[3] = rc->renderData.border.width.bottom;
            break;
        case CLAY_RENDER_COMMAND_TYPE_TEXT:
            c->color = pack(rc->renderData.text.textColor);
            c->text = (uint32_t)(uintptr_t)rc->renderData.text.stringContents.chars;
            c->textLength = (uint32_t)rc->renderData.text.stringContents.length;
            c->fontId = rc->renderData.text.fontId;
            c->fontSize = rc->renderData.text.fontSize;
            break;
        default: break;
        }
    }
}

__attribute__((export_name("cmd_count"))) int32_t page_command_count(void) { return commandCount; }
__attribute__((export_name("cmd_size"))) int32_t page_command_size(void) { return (int32_t)sizeof(WebCommand); }
__attribute__((export_name("cmds"))) WebCommand *page_commands(void) { return commands; }
__attribute__((export_name("measure_slot"))) float *page_measure_slot(void) { return measureSlot; }
__attribute__((export_name("errors"))) uint32_t page_errors(void) { return clayErrors; }
