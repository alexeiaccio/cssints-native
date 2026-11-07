// The browser target: Clay + the Sensors page that generator/page-to-c.ts emitted to C, compiled to WebAssembly.
// No JS at run time: the page is the generated C *state machine* (examples/sensors/page_generated_events.c), the host
// keeps the state and a click on the pill asks its table — the same table the desktop host and gen.c use.
//
// Text measurement is the one thing Clay cannot do without a font, and the page draws its text with Canvas2D. So the
// measure callback calls into JS (env.measure), which measures with the same font the canvas draws with, and writes
// the width and the height back into measure_slot(). The layout is therefore the browser's own font metrics, not a
// table copied from another raster.
//
// ABI (all ints and floats are 32-bit, little endian, in the wasm's linear memory):
//   init(width, height)      Clay's arena and layout dimensions; call once
//   frame()                  declare the current state (`sensors_frame`) and lay it out; then the command array
//   press(x, y)              the button down over the page at x,y: the state the table gives for a press on the
//                            element under it (its :active, or the same state if no handler is there); returns the state
//   release()                the button up: the state a click on the pressed element leads to (with :hover), or the
//                            state before the press when the release is not over it; returns the state
//   state()                  the current state index, and state_name(i) its name
//   cmd_count()              commands in the last frame
//   cmd_size()               bytes per command record (19 int32/float slots, 76 bytes)
//   cmds()                   address of the first command record
//   text(ptr, len)           the text bytes are in the same linear memory: (ptr, len) in slots 15, 16
//   measure_slot()           float[2] the JS measure callback writes (width, height)
//   errors()                 Clay errors since init
//   dump()                   the last frame as JSON (desktop/clay_dump.c, the one emitter on every target) into the
//                            linear memory, its byte length returned; dump_ptr() is where it starts
// A record is 19 32-bit slots: type, id, x, y, w, h, color (r<<16 | g<<8 | b | a<<24),
//                             radius tl, tr, br, bl, border l, r, t, b, text ptr, text len, font id, font size.
#define CLAY_IMPLEMENTATION
#include "clay.h"

#include <stdint.h>
#include <stdlib.h>

#include "../desktop/clay_dump.c"
#include "events.h"
#include "styles.h"

// the generated state machine: page_generated_events.c, the frames through `sensors_frame(state, light)`
int sensors_state_count(void);
const char *sensors_state_name(int state);
int sensors_next(int state, uint32_t id, int event);
int sensors_handler_count(void);
uint32_t sensors_handler_id(int index);
void sensors_frame(int state, int light);

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
// the last frame's command array, for dump(): the records above are the drawing's view, the dump is the emitter's
static Clay_RenderCommandArray lastCommands;
static char *dumpBytes;
static int32_t dumpLength;
// the state machine: the state the host draws, the element a press went down on, and the state before it
static int32_t pageState, pageRest;
static uint32_t pagePressed;
static Clay_Vector2 pagePointer;

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

__attribute__((export_name("frame"))) void page_frame(void)
{
    Clay_SetLayoutDimensions(layoutSize);
    Clay_BeginLayout();
    sensors_frame(pageState, 0);
    Clay_RenderCommandArray array = Clay_EndLayout(1.0f / 60.0f);
    lastCommands = array;

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
__attribute__((export_name("state"))) int32_t page_current_state(void) { return pageState; }
__attribute__((export_name("state_name"))) const char *page_state_name(int32_t state) { return sensors_state_name(state); }

/** The element with a handler under the pointer, from Clay's pointerOverIds (the last layout's), or 0. */
static uint32_t page_hit(void)
{
    for (int i = 0; i < sensors_handler_count(); i++) {
        const uint32_t id = sensors_handler_id(i);
        if (id && Clay_PointerOver((Clay_ElementId){.id = id})) return id;
    }
    return 0;
}

/** The button down at x,y: the press state of the element under it (or the same state), as the desktop host dispatches. */
__attribute__((export_name("press"))) int32_t page_press(float x, float y)
{
    pagePointer = (Clay_Vector2){x, y};
    Clay_SetPointerState(pagePointer, true);
    const uint32_t id = page_hit();
    if (id) {
        pageRest = pageState;
        pagePressed = id;
        pageState = sensors_next(pageState, id, CLAY_EVENT_PRESS);
    }
    return pageState;
}

/** The button up at x,y: a click on the element the press was on, or the state before the press when it is elsewhere. */
__attribute__((export_name("release"))) int32_t page_release(float x, float y)
{
    pagePointer = (Clay_Vector2){x, y};
    Clay_SetPointerState(pagePointer, false);
    if (pagePressed) {
        const uint32_t id = pagePressed;
        pagePressed = 0;
        pageState = Clay_PointerOver((Clay_ElementId){.id = id}) ? sensors_next(pageState, id, CLAY_EVENT_RELEASE)
                                                                 : pageRest;
    }
    return pageState;
}

/** The last frame as clay_dump.c's JSON, replacing the previous one: its length, and its bytes at dump_ptr(). The page
 *  has no shadows, backdrops, gradients or groups (empty tables) and no id strings (a command's `element` is null: the
 *  check resolves it by id from the golden). */
__attribute__((export_name("dump"))) int32_t page_dump(void)
{
    const ClayDumpFrame frame = {.commands = lastCommands,
                                 .width = (int)layoutSize.width,
                                 .height = (int)layoutSize.height,
                                 .scale = 1,
                                 .hash = 0,
                                 .textWeight = 0};
    const ClayDump dump = Clay_DumpFrame(&frame);
    free(dumpBytes);
    dumpBytes = dump.bytes, dumpLength = dump.length;
    return dumpLength;
}

__attribute__((export_name("dump_ptr"))) char *page_dump_bytes(void) { return dumpBytes; }
