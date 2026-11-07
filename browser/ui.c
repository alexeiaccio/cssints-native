// The Solid page's half of the browser target: the same flat `ui_*` surface solid/native/ui.c gives bun:ffi, over Clay
// and nothing else — no SDL, no window, no ThorVG. The page (browser/solid/) is the desktop's own modules (src/frame.ts,
// src/renderer.ts, app/Sky.tsx) compiled by Bun for the browser; they call these functions through
// browser/solid/ffi-browser.ts, and the raster is Canvas2D over the command array and the effect tables (browser/draw.js),
// as the no-JS page's is (browser/page.c, which declares no effects).
//
// Kept from the desktop's ui.c: the packed style floats (45 fields), the text's 10, the value channel, the text arena,
// Clay's own scroll containers (`ui_scroll_*`), the pointer over an id, the frame hash, the dump through
// desktop/clay_dump.c and the page's id strings behind Clay's hashes.
// Kept as tables beside the commands, as the desktop's renderer keeps them (fields 45-50 and 55 of the value channel
// included): a shadow (`ui_shadow`), a linear gradient (`ui_backgroundImage`), a group — one element's subtree at an
// alpha, a scale, a translate and a rotation — an image's path (`ui_image`), and the backdrop's blur (`ui_backdrop`,
// recorded and hashed; browser/draw.js draws the element's own tint and no blur, see native/README.md).
// Dropped, because each was the desktop's window:
//   - ui_window_*, SDL's key/text queues, the clipboard, PNG load/save/diff, `ui_pixel`/`ui_pixels_copy` (the pixels are
//     the page's canvas: ffi-browser reads them with getImageData);
//   - `ui_density` (the canvas's devicePixelRatio is the page's), `ui_font` (the page loads Roboto as a FontFace and
//     Canvas2D measures with it; a font id is the style's), `ui_init_gpu`.
//
// ABI, all 32-bit little endian in the linear memory (browser/solid/ffi-browser.ts allocates):
//   ui_init(w, h)              Clay's arena and the layout's size; once
//   ui_begin(px, py, down, dt)  the pointer, then Clay's layout opens
//   ui_open(id, len, style)    45 floats; ui_text(id, len, bytes, len, style) 10 floats; ui_close()
//   ui_end(dt)                 layout: the command count
//   ui_value(id, len, field, v) the frame's overrides, before the tree
//   ui_shadow(x, y, blur, r, g, b, a), ui_backdrop(blur), ui_image(path, len),
//   ui_backgroundImage(kind, angle, count, stops)   the next ui_open's effects, as the desktop's
//   cmd_count(), cmd_size(), cmds(), measure_slot()   the commands of the last frame, for JS to draw
//   fx(kind), fx_count(kind), fx_stride(kind)        its effect tables (shadow 0, backdrop 1, gradient 2, group 3)
//   ui_hash()                  the frame's hash, so a host skips the draw of an unchanged frame
//   dump(), dump_ptr()         the last frame as clay_dump.c's JSON, as browser/page.c has it
//   malloc(n), free(p)         for JS: the strings, ids and float arrays it passes in
#define CLAY_IMPLEMENTATION
#include "clay.h"

#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "../desktop/clay_dump.c" // the one emitter every host dumps through
// the terminal's cells, reused rather than ported: the console target is the terminal's grid, printed instead of drawn
#include "../terminal/cells.h"
#include "../terminal/render.h"

#define EXPORT(name) __attribute__((export_name(name)))

// a style is a compile-time literal (solid/plugin.ts packs it once); only the value channel moves its numbers
#define STYLE_FIELDS 45
#define TEXT_FIELDS 10
#define FIELD_SHADOW_BLUR 45 // the blur of the element's shadow: a renderer table, not one of the 45
#define FIELD_ALPHA 46
#define FIELD_SCALE 47
#define FIELD_TRANSLATE_X 48
#define FIELD_TRANSLATE_Y 49
#define FIELD_GRADIENT_ALPHA 50
#define FIELD_TEXT_COLOR_R 51
#define FIELD_TEXT_COLOR_A 54
#define FIELD_ROTATE 55

// the page's text lives here for the frame: Clay keeps the pointer until the render pass (the desktop's sizes)
#define ARENA_SIZE (1 << 16)
// ponytail: 1,024 overrides a frame, as the desktop's and the terminal's (a figure's item writes three; a palette of two
// hues' thirteen steps is 429)
#define MAX_VALUES 1024
// ponytail: 512 names a page (ui_init starts the table over); later ids are unnamed in a dump
#define MAX_ID_NAMES 512
// ponytail: 512 elements a frame (a command of one carries its node for the dump's text alignment and a group's subtree)
#define MAX_NODES 512
// ponytail: 64 elements deep, as the desktop's tree; a deeper page keeps the deepest parent it recorded
#define MAX_DEPTH 64
// browser/page.c's 64 is the generated page's; a Solid page's tree is bigger (the Widgets page's is 55 commands)
#define MAX_COMMANDS 1024
// the renderer's tables, as the desktop's renderer sizes them: shadows and gradients keyed by the element's Clay id, a
// backdrop by the element it blurs, a group by the tree node of the element whose subtree it is
#define MAX_SHADOWS 32
#define MAX_BACKDROPS 8
#define MAX_GRADIENTS 16
#define MAX_GRADIENT_STOPS 8
#define MAX_GROUPS 16
// ponytail: 64 distinct image paths a process, never freed; a page with more needs a bigger table
#define MAX_IMAGES 64
// a table row in 32-bit slots: the JS reads the id and the counts as an Int32Array and the rest as a Float32Array over
// the same bytes (readEffects in browser/draw.js), so the layout is the one below and nowhere else
#define SHADOW_SLOTS 8   // id, x, y, blur, r, g, b, a
#define BACKDROP_SLOTS 2 // id, blur
#define GRADIENT_SLOTS (5 + 5 * MAX_GRADIENT_STOPS) // id, kind, angle, alpha, count, then 8 x (offset, r, g, b, a)
#define GROUP_SLOTS 10   // node, first, last, alpha, scale, tx, ty, rotate, cx, cy

// browser/page.c's WebCommand, unchanged, so draw.js's readCommands reads both wasms the same way
typedef struct {
    int32_t type, id;
    float x, y, w, h;
    uint32_t color;
    float radius[4];
    float border[4];
    uint32_t text, textLength;
    int32_t fontId, fontSize;
} WebCommand;

static WebCommand commands[MAX_COMMANDS];
static int32_t command_count;
static char arena[ARENA_SIZE];
static int arena_used;
static int width, height, errors;
static Clay_RenderCommandArray cmds;
// the console sink's grid, made from the first frame (the layout's size / 8x16), its previous frame and its output
static Cells term_grid;
static int term_ready;
static Text term_text;
static Cells term_prev;
static int term_prev_ok;
static uint64_t frame_hash = 0xcbf29ce484222325ull;
static int draw_count;
// the host's paints (ui_present): the page's raster is JS's, so the dev panel's `presents` is the shell's own count
static int present_count;

// the value channel: this frame's overrides of a packed style, by element id
static struct {
    uint32_t id;
    uint16_t field;
    float value;
} values[MAX_VALUES];
static int value_count;

// the frame's element tree, in declaration order: a node's Clay id and the node it was declared in (-1 at the root). A
// group names a node, and Clay's commands carry it (`userData`, index + 1), so a subtree is a range of commands — the
// same walk the desktop's renderer does (Clay_ThorVG_Under and its spans).
static uint32_t node_ids[MAX_NODES];
static int32_t node_parent[MAX_NODES];
static int32_t open_nodes[MAX_DEPTH];
static int open_depth;

// the renderer's tables, reset by `ui_begin`: a row of slots per effect, as the desktop's renderer keeps them
static float shadow_table[MAX_SHADOWS * SHADOW_SLOTS];
static int shadow_count;
static float backdrop_table[MAX_BACKDROPS * BACKDROP_SLOTS];
static int backdrop_count;
static float gradient_table[MAX_GRADIENTS * GRADIENT_SLOTS];
static int gradient_count;
static float group_table[MAX_GROUPS * GROUP_SLOTS];
static int group_count;

// each command's element node, after `ui_end`: a command that carries none (a scissor's own pair, an overlay) belongs to
// the last element that had one, so a group's range cannot widen past the element it was declared in
static int32_t command_node[MAX_COMMANDS];

// the effects the next `ui_open` declares, as the desktop's pendings: Clay has no field for any of them
static float pending_shadow[3];
static float pending_shadow_color[4];
static int has_pending_shadow;
static float pending_backdrop = -1;
static struct {
    int kind; // 1: linear (the only kind cssints/clay writes)
    float angle;
    int count;
    float stops[MAX_GRADIENT_STOPS][5]; // offset (0..1), then r, g, b, a 0-255
} pending_gradient;
static int has_pending_gradient;
// an image's path is one pointer for the process (Clay's image config is that pointer, and the dump prints the path): a
// per-frame copy would be a different image every frame
static char *image_paths[MAX_IMAGES];
static int image_count;
static const char *pending_image;

// the page's id strings, by Clay's hash: a dump names a command's element from it
static ClayDumpName id_names[MAX_ID_NAMES];
static int id_name_count;
// each node's text alignment and wrap, by node: Clay's text command carries neither (the dump reads them)
static unsigned char text_align[MAX_NODES], text_wrap[MAX_NODES];
static int node_count;

// the wheel this module took, in Clay's units (positive scrolls the content down, as SDL's wheel y)
static float wheel_x, wheel_y, page_wheel_x, page_wheel_y;
static int auto_scroll = 1;

static float measure_slot[2];
// the measure callback's answer goes through this: Canvas2D, in browser/solid/ffi-browser.ts
extern void measure_text(const char *chars, int length, int fontId, int fontSize)
    __attribute__((import_module("env"), import_name("measure")));

static void on_error(Clay_ErrorData e)
{
    (void)e;
    errors++;
}

static Clay_Dimensions measure(Clay_StringSlice text, Clay_TextElementConfig *config, void *user)
{
    (void)user;
    const int size = config->fontSize ? config->fontSize : 14;
    measure_text(text.chars, text.length, config->fontId, size);
    return (Clay_Dimensions){measure_slot[0], config->lineHeight ? (float)config->lineHeight : measure_slot[1]};
}

EXPORT("measure_slot") float *page_measure_slot(void) { return measure_slot; }

static Clay_String slice(const char *s, int len) { return (Clay_String){.length = len, .chars = s}; }

/** Colours arrive as 0-255 floats; one int32 is r<<16 | g<<8 | b | a<<24 for JS's "#rrggbb" (browser/page.c's rule). */
static uint32_t channel(float v) { return v <= 0 ? 0 : v >= 255 ? 255 : (uint32_t)(v + 0.5f); }
static uint32_t pack(Clay_Color c)
{
    return channel(c.r) << 16 | channel(c.g) << 8 | channel(c.b) | channel(c.a) << 24;
}

EXPORT("ui_init") int32_t ui_init(int32_t w, int32_t h)
{
    width = w, height = h;
    // a page's ids start empty: ui_init is a new page (the golden test captures every spec in one process, and the dump
    // names only what this page declared), and the names are ours to free
    for (int i = 0; i < id_name_count; i++) free(id_names[i].name);
    id_name_count = 0;
    const uint32_t needed = Clay_MinMemorySize();
    char *memory = malloc(needed);
    if (!memory) {
        errors++;
        return 1;
    }
    Clay_Initialize(Clay_CreateArenaWithCapacityAndMemory(needed, memory), (Clay_Dimensions){(float)w, (float)h},
                    (Clay_ErrorHandler){on_error, 0});
    Clay_SetMeasureTextFunction(measure, 0);
    return 0;
}

/** A font file is the page's (a FontFace, measured by Canvas2D): a style's font id is what it is. 0, as the first id. */
EXPORT("ui_font") int32_t ui_font(const char *path)
{
    (void)path;
    return 0;
}

EXPORT("ui_errors") int32_t ui_errors(void) { return errors; }

/** Adds a wheel delta to the next frame, in Clay's units: positive scrolls the content down. */
EXPORT("ui_wheel") void ui_wheel(float dx, float dy)
{
    wheel_x += dx, wheel_y += dy;
    page_wheel_x += dx, page_wheel_y += dy;
}

/** The wheel since the last pop into out[2], drained; 0 when there is none. */
EXPORT("ui_wheel_pop") int32_t ui_wheel_pop(float *out)
{
    if (page_wheel_x == 0 && page_wheel_y == 0) return 0;
    out[0] = page_wheel_x, out[1] = page_wheel_y;
    page_wheel_x = page_wheel_y = 0;
    return 1;
}

/** Turns Clay's own wheel scrolling on (1, the default) or off (0): a page that scrolls itself owns the offset. */
EXPORT("ui_auto_scroll") void ui_auto_scroll(int32_t on) { auto_scroll = on != 0; }

/** Pointer position and button for this frame, then Clay opens the layout. */
EXPORT("ui_begin") void ui_begin(float px, float py, int32_t down, float dt)
{
    arena_used = 0;
    value_count = 0;
    node_count = 0;
    open_depth = 0;
    shadow_count = backdrop_count = gradient_count = group_count = 0;
    pending_image = NULL;
    has_pending_shadow = 0;
    pending_backdrop = -1;
    has_pending_gradient = 0;
    Clay_SetPointerState((Clay_Vector2){px, py}, down);
    if (auto_scroll) Clay_UpdateScrollContainers(0, (Clay_Vector2){wheel_x, wheel_y}, dt);
    wheel_x = 0, wheel_y = 0;
    Clay_BeginLayout();
}

// ---------- the renderer's tables: a shadow, a backdrop, a gradient, a group, an image ----------

/** A 32-bit id or count in a row of floats: the JS reads that slot as an int32 (a float32 cannot hold a Clay hash). */
static void put_u32(float *at, uint32_t v) { memcpy(at, &v, sizeof v); }

/** Room for one more row of `slots` floats, or NULL when the table is full: a full table is not an error, as on the
 *  desktop (the effect is dropped, and the dump and the hash see what was drawn). */
static float *row(float *table, int *count, int max, int slots)
{
    if (*count == max) return NULL;
    float *r = table + (size_t)(*count)++ * slots;
    memset(r, 0, (size_t)slots * sizeof(float));
    return r;
}

/** The image the next `ui_open` declares: the path, interned so that one path arrives as one address every frame (Clay's
 *  image config is that pointer, and browser/draw.js keys its decoded bitmaps on it). */
EXPORT("ui_image") void ui_image(const char *path, int32_t len)
{
    for (int i = 0; i < image_count; i++)
        if ((int)strlen(image_paths[i]) == len && memcmp(image_paths[i], path, (size_t)len) == 0) {
            pending_image = image_paths[i];
            return;
        }
    if (image_count == MAX_IMAGES) {
        errors++;
        return;
    }
    image_paths[image_count] = strndup(path, (size_t)len);
    pending_image = image_paths[image_count++];
}

/** The shadow of the next element (`css.shadow`): its box moved by x and y, blurred by blur, in that colour. */
EXPORT("ui_shadow") void ui_shadow(float x, float y, float blur, float r, float g, float b, float a)
{
    pending_shadow[0] = x, pending_shadow[1] = y, pending_shadow[2] = blur;
    pending_shadow_color[0] = r, pending_shadow_color[1] = g, pending_shadow_color[2] = b, pending_shadow_color[3] = a;
    has_pending_shadow = 1;
}

/** The backdrop of the next element (`css.backdrop`): its blur radius. Recorded and hashed; browser/draw.js draws no
 *  blur (native/README.md's browser chapter says why). */
EXPORT("ui_backdrop") void ui_backdrop(float blur) { pending_backdrop = blur; }

/** The background image of the next element (`css.backgroundImage`): a linear gradient at `angle` degrees in CSS's reading
 *  (0 up, 90 right), `count` stops of (offset 0..1, r, g, b, a) each, flattened. */
EXPORT("ui_backgroundImage") void ui_backgroundImage(int32_t kind, float angle, int32_t count, const float *stops)
{
    if (count > MAX_GRADIENT_STOPS) errors++, count = MAX_GRADIENT_STOPS;
    if (count < 2) errors++;
    pending_gradient.kind = kind, pending_gradient.angle = angle, pending_gradient.count = count;
    if (count > 0) memcpy(pending_gradient.stops, stops, (size_t)count * 5 * sizeof(float));
    has_pending_gradient = 1;
}

/** The table of one kind of effect (0 shadow, 1 backdrop, 2 gradient, 3 group) and its row count: JS reads it with
 *  `fx_stride`'s slots a row, the ids as int32 and the rest as floats. */
EXPORT("fx") float *ui_fx(int32_t kind)
{
    switch (kind) {
    case 0: return shadow_table;
    case 1: return backdrop_table;
    case 2: return gradient_table;
    case 3: return group_table;
    default: return NULL;
    }
}

EXPORT("fx_count") int32_t ui_fx_count(int32_t kind)
{
    switch (kind) {
    case 0: return shadow_count;
    case 1: return backdrop_count;
    case 2: return gradient_count;
    case 3: return group_count;
    default: return 0;
    }
}

EXPORT("fx_stride") int32_t ui_fx_stride(int32_t kind)
{
    switch (kind) {
    case 0: return SHADOW_SLOTS;
    case 1: return BACKDROP_SLOTS;
    case 2: return GRADIENT_SLOTS;
    case 3: return GROUP_SLOTS;
    default: return 0;
    }
}

/** True when the pointer is over the element of that id in the layout of the last frame. */
EXPORT("ui_pointer_over") int32_t ui_pointer_over(const char *id, int32_t len)
{
    return Clay_PointerOver(Clay__HashString(slice(id, len), 0));
}

static Clay_SizingAxis axis(const float *f)
{
    Clay_SizingAxis a = {0};
    a.type = (Clay__SizingType)f[0]; // 0 FIT, 1 GROW, 2 PERCENT, 3 FIXED: Clay's own order
    if (a.type == CLAY__SIZING_TYPE_PERCENT) a.size.percent = f[1];
    else a.size.minMax.min = f[1], a.size.minMax.max = f[2];
    return a;
}

static Clay_Color color(const float *f) { return (Clay_Color){f[0], f[1], f[2], f[3]}; }

// the page's id string of an element, kept by Clay's hash of it
static void intern_id(uint32_t id, const char *s, int len)
{
    if (!s || len <= 0) return;
    for (int i = 0; i < id_name_count; i++)
        if (id_names[i].id == id) return;
    if (id_name_count == MAX_ID_NAMES) return;
    id_names[id_name_count].id = id;
    id_names[id_name_count].name = strndup(s, (size_t)len);
    id_name_count++;
}

/** An override of one number of the style of the element with that id, for this frame only: fields 0..44 are the packed
 *  fields, 45 the blur of the element's shadow, 46 the opacity of its whole subtree (a group), 47 a scale about its box
 *  centre, 48/49 a visual offset of it, 50 the opacity of its background image, 51..54 the colour of the text with that id
 *  and 55 the rotation of its subtree in degrees. The group's fields are not floats of the style: they go to the
 *  renderer's table, as the shadow's blur does. */
EXPORT("ui_value") void ui_value(const char *id, int32_t len, int32_t field, float value)
{
    if (field < 0 || field > FIELD_ROTATE || value_count == MAX_VALUES) {
        errors++;
        return;
    }
    values[value_count].id = Clay__HashString(slice(id, len), 0).id;
    values[value_count].field = (uint16_t)field;
    values[value_count].value = value;
    value_count++;
}

/** Opens an element. id is NULL for an anonymous one; f is 45 floats: the box fields, then the floating ones. */
EXPORT("ui_open") void ui_open(const char *id, int32_t len, const float *style)
{
    static const Clay_LayoutAlignmentX ax[3] = {CLAY_ALIGN_X_LEFT, CLAY_ALIGN_X_CENTER, CLAY_ALIGN_X_RIGHT};
    static const Clay_LayoutAlignmentY ay[3] = {CLAY_ALIGN_Y_TOP, CLAY_ALIGN_Y_CENTER, CLAY_ALIGN_Y_BOTTOM};
    Clay_ElementId eid = {0};
    if (id) eid = Clay__HashString(slice(id, len), 0);
    if (id) intern_id(eid.id, id, len);
    // the value channel: this element's overrides, applied to a copy of its own floats. The renderer's fields are not of
    // the 45: they go to the tables beside the commands, as the desktop's ui.c sends them to its renderer.
    float over[STYLE_FIELDS];
    const float *f = style;
    float shadow_blur = -1, gradient_alpha = 255;
    int alpha = 255, grouped = 0;
    float scale = 1, tx = 0, ty = 0, rotate = 0;
    if (id && value_count) {
        int mine = 0;
        for (int i = 0; i < value_count; i++) mine += values[i].id == eid.id;
        if (mine) {
            memcpy(over, style, sizeof over);
            for (int i = 0; i < value_count; i++) {
                if (values[i].id != eid.id) continue;
                const int field = values[i].field;
                if (field == FIELD_SHADOW_BLUR) shadow_blur = values[i].value;
                else if (field == FIELD_ALPHA) alpha = (int)(values[i].value + 0.5f), grouped = 1;
                else if (field == FIELD_SCALE) scale = values[i].value, grouped = 1;
                else if (field == FIELD_TRANSLATE_X) tx = values[i].value, grouped = 1;
                else if (field == FIELD_TRANSLATE_Y) ty = values[i].value, grouped = 1;
                else if (field == FIELD_ROTATE) rotate = values[i].value, grouped = 1;
                else if (field == FIELD_GRADIENT_ALPHA) gradient_alpha = values[i].value;
                // 51..54 are a text's, not a box's: ui_text reads them, and they would be past the end of these floats
                else if (field < STYLE_FIELDS) over[field] = values[i].value;
            }
            f = over;
        }
    }
    Clay_ElementDeclaration d = {0};
    d.layout.sizing.width = axis(f + 0);
    d.layout.sizing.height = axis(f + 3);
    d.layout.padding = (Clay_Padding){f[6], f[7], f[8], f[9]};
    d.layout.childGap = f[10];
    d.layout.childAlignment = (Clay_ChildAlignment){ax[(int)f[11]], ay[(int)f[12]]};
    d.layout.layoutDirection = f[13] ? CLAY_TOP_TO_BOTTOM : CLAY_LEFT_TO_RIGHT;
    d.backgroundColor = color(f + 14);
    d.cornerRadius = (Clay_CornerRadius){f[18], f[19], f[20], f[21]};
    d.border.width = (Clay_BorderWidth){f[22], f[23], f[24], f[25]};
    d.border.color = color(f + 26);
    d.clip.horizontal = f[30] != 0, d.clip.vertical = f[31] != 0;
    if (f[32] != 0) {
        d.floating.attachTo = (Clay_FloatingAttachToElement)(int)f[33];
        // the id arrives as two 16-bit halves: a float32 cannot hold the 32-bit hash exactly
        d.floating.parentId = ((uint32_t)f[34] << 16) | (uint32_t)f[35];
        d.floating.attachPoints = (Clay_FloatingAttachPoints){(Clay_FloatingAttachPointType)(int)f[36],
                                                              (Clay_FloatingAttachPointType)(int)f[37]};
        d.floating.offset = (Clay_Vector2){f[38], f[39]};
        d.floating.expand = (Clay_Dimensions){f[40], f[41]};
        d.floating.zIndex = (int16_t)f[42];
        d.floating.pointerCaptureMode = (Clay_PointerCaptureMode)(int)f[43];
        d.floating.clipTo = (Clay_FloatingClipToElement)(int)f[44];
    }
    // the style's image (css.image), set by ui_image just before this call; cleared so a sibling cannot inherit it
    if (pending_image) {
        d.image.imageData = (void *)pending_image;
        pending_image = NULL;
    }
    // ... and its shadow (css.shadow): the command with this element's id is where the table's row is drawn, and the
    // value channel's blur (field 45) is what a page animating one writes
    if (has_pending_shadow) {
        has_pending_shadow = 0;
        float *s = id ? row(shadow_table, &shadow_count, MAX_SHADOWS, SHADOW_SLOTS) : NULL;
        if (s) {
            put_u32(s, eid.id);
            s[1] = pending_shadow[0], s[2] = pending_shadow[1];
            s[3] = shadow_blur >= 0 ? shadow_blur : pending_shadow[2];
            s[4] = pending_shadow_color[0], s[5] = pending_shadow_color[1], s[6] = pending_shadow_color[2];
            s[7] = pending_shadow_color[3];
        }
    }
    // ... its backdrop (css.backdrop): recorded for the dump and the hash; the draw draws no blur (ui_backdrop)
    if (pending_backdrop >= 0) {
        float *b = id ? row(backdrop_table, &backdrop_count, MAX_BACKDROPS, BACKDROP_SLOTS) : NULL;
        if (b) put_u32(b, eid.id), b[1] = pending_backdrop;
        pending_backdrop = -1;
    }
    // ... and its gradient (css.backgroundImage): the first rectangle command with this id is filled with it
    if (has_pending_gradient) {
        has_pending_gradient = 0;
        float *g = id ? row(gradient_table, &gradient_count, MAX_GRADIENTS, GRADIENT_SLOTS) : NULL;
        if (g) {
            int count = pending_gradient.count;
            if (count < 2) count = 0;
            if (gradient_alpha < 0) gradient_alpha = 0;
            if (gradient_alpha > 255) gradient_alpha = 255;
            put_u32(g, eid.id);
            put_u32(g + 1, (uint32_t)pending_gradient.kind);
            g[2] = pending_gradient.angle;
            put_u32(g + 3, (uint32_t)(int)gradient_alpha);
            put_u32(g + 4, (uint32_t)count);
            for (int k = 0; k < count; k++) memcpy(g + 5 + k * 5, pending_gradient.stops[k], 5 * sizeof(float));
        }
    }
    if (id) Clay__OpenElementWithId(eid);
    else Clay__OpenElement();
    // The frame's element tree, in declaration order: the node's parent is the element that was open before it. Clay gives
    // an anonymous element an id of its own on open, so it is read back after. The node index is what a command carries
    // (userData), what a group names and what the dump reads a text's alignment by.
    if (node_count < MAX_NODES) {
        Clay_LayoutElement *open = Clay__GetOpenLayoutElement();
        const int32_t node = node_count++;
        node_ids[node] = open->id;
        node_parent[node] = open_depth ? open_nodes[open_depth - 1] : -1;
        d.userData = (void *)(uintptr_t)(node + 1);
        // a group is the element's whole subtree at its alpha, scale, translate and rotation: a row per element, its
        // command range filled in `ui_end` (the commands are not laid out yet)
        if (grouped) {
            float *g = row(group_table, &group_count, MAX_GROUPS, GROUP_SLOTS);
            if (g) {
                if (alpha < 0) alpha = 0;
                if (alpha > 255) alpha = 255;
                if (scale < 0.01f) scale = 0.01f;
                put_u32(g, (uint32_t)node), put_u32(g + 1, 0), put_u32(g + 2, 0), put_u32(g + 3, (uint32_t)alpha);
                g[4] = scale, g[5] = tx, g[6] = ty, g[7] = rotate;
                g[8] = g[9] = 0; // the centre: the first command's box's, in `ui_end`
                // a group at 255, 1, no offset and no rotation is a scene that draws what the literal already drew: the
                // desktop's renderer skips it, and its hash does not see it
                if (alpha >= 255 && scale == 1 && tx == 0 && ty == 0 && rotate == 0) group_count--;
            }
        }
        if (open_depth < MAX_DEPTH) open_nodes[open_depth++] = node;
    } else errors++; // ponytail: MAX_NODES elements a frame; a deeper page needs a bigger table
    // a clip element is a scroll container: the offset Clay kept for it across frames is what shifts its children
    if (d.clip.horizontal || d.clip.vertical) d.clip.childOffset = Clay_GetScrollOffset();
    Clay__ConfigureOpenElement(d);
}

EXPORT("ui_close") void ui_close(void)
{
    Clay__CloseElement();
    if (open_depth) open_depth--;
}

/** A text element, with an id or NULL. A text's colour is its own four floats: with an id, fields 51..54 override the
 *  colour of its copy of the 10 (the value channel's second kind of target). The bytes are copied for the frame. */
EXPORT("ui_text") void ui_text(const char *id, int32_t id_len, const char *s, int32_t len, const float *f)
{
    static const Clay_TextAlignment al[3] = {CLAY_TEXT_ALIGN_LEFT, CLAY_TEXT_ALIGN_CENTER, CLAY_TEXT_ALIGN_RIGHT};
    static const Clay_TextElementConfigWrapMode wm[3] = {CLAY_TEXT_WRAP_WORDS, CLAY_TEXT_WRAP_NEWLINES,
                                                         CLAY_TEXT_WRAP_NONE};
    // ponytail: 64 KB of text a frame; a longer page needs a bigger arena
    if (len < 0 || arena_used + len > ARENA_SIZE) {
        errors++;
        return;
    }
    char *copy = arena + arena_used;
    memcpy(copy, s, (size_t)len);
    arena_used += len;
    Clay_ElementId eid = {0};
    float over[TEXT_FIELDS];
    const float *tf = f;
    if (id) {
        eid = Clay__HashString(slice(id, id_len), 0);
        intern_id(eid.id, id, id_len);
        int mine = 0;
        for (int i = 0; i < value_count; i++)
            mine += values[i].id == eid.id && values[i].field >= FIELD_TEXT_COLOR_R &&
                    values[i].field <= FIELD_TEXT_COLOR_A;
        if (mine) {
            memcpy(over, f, sizeof over);
            for (int i = 0; i < value_count; i++)
                if (values[i].id == eid.id && values[i].field <= FIELD_TEXT_COLOR_A)
                    over[values[i].field - FIELD_TEXT_COLOR_R] = values[i].value;
            tf = over;
        }
    }
    Clay_TextElementConfig c = {0};
    c.textColor = color(tf);
    c.fontId = tf[4], c.fontSize = tf[5], c.letterSpacing = tf[6], c.lineHeight = tf[7];
    c.textAlignment = al[(int)tf[8]], c.wrapMode = wm[(int)tf[9]];
    if (node_count < MAX_NODES) {
        const int32_t node = node_count++;
        c.userData = (void *)(uintptr_t)(node + 1);
        text_align[node] = (unsigned char)tf[8], text_wrap[node] = (unsigned char)tf[9];
        // the text's own node: its id is the page's when it has one, else the address Clay derives it from (its parent and
        // its place among the children), and its parent is the element it was declared in, so a group's subtree reaches it
        Clay_LayoutElement *parent = Clay__GetOpenLayoutElement();
        node_ids[node] = id ? eid.id : Clay__HashNumber(parent->children.length + parent->floatingChildrenCount,
                                                       parent->id).id;
        node_parent[node] = open_depth ? open_nodes[open_depth - 1] : -1;
    } else errors++;
    Clay__OpenTextElement(slice(copy, len), c);
}

static void hash_frame(void);

/** Is the tree node `node` the element `at` or one of its descendants? The desktop renderer's walk (Clay_ThorVG_Under). */
static int under(int32_t at, int32_t node)
{
    for (int32_t n = node, guard = 0; n >= 0 && guard <= node_count; n = node_parent[n], guard++)
        if (n == at) return 1;
    return 0;
}

/** Each group's command range, after the layout: the commands whose element is the group's node or under it, in depth-first
 *  order (Clay's own), and the centre of the first command's box, which is the scale's and the rotation's origin. A group
 *  with no command of its own is dropped, as the desktop drops an empty span. */
static void settle_groups(void)
{
    // a clip's close carries no node of its own (Clay emits it from a derived id): it belongs to the element that opened
    // the clip, so a group inside the clip cannot swallow the close and leave the page clipped (the desktop's ThorVG
    // closes the clip with the group's scene, so the next element after it draws unclipped)
    int32_t opened[64];
    int depth = 0;
    for (int32_t i = 0; i < command_count; i++) {
        if (commands[i].type == CLAY_RENDER_COMMAND_TYPE_SCISSOR_START) {
            if (depth < (int)(sizeof opened / sizeof *opened)) opened[depth++] = command_node[i];
        } else if (commands[i].type == CLAY_RENDER_COMMAND_TYPE_SCISSOR_END && depth) {
            command_node[i] = opened[--depth];
        }
    }
    int kept = 0;
    for (int g = 0; g < group_count; g++) {
        float *row_in = group_table + (size_t)g * GROUP_SLOTS;
        uint32_t node_bits;
        memcpy(&node_bits, row_in, sizeof node_bits);
        const int32_t at = (int32_t)node_bits;
        int32_t first = -1, last = -1;
        for (int32_t i = 0; i < command_count; i++) {
            if (!under(at, command_node[i])) continue;
            if (first < 0) first = i;
            last = i;
        }
        if (first < 0) continue;
        float *g_out = group_table + (size_t)kept++ * GROUP_SLOTS;
        memmove(g_out, row_in, GROUP_SLOTS * sizeof(float));
        put_u32(g_out + 1, (uint32_t)first);
        put_u32(g_out + 2, (uint32_t)last);
        const WebCommand *c = &commands[first];
        g_out[8] = c->x + c->w / 2;
        g_out[9] = c->y + c->h / 2;
    }
    group_count = kept;
}

/** Closes the layout: Clay computes the boxes. Returns the command count, and hashes the frame for `ui_hash`. */
EXPORT("ui_end") int32_t ui_end(float dt)
{
    cmds = Clay_EndLayout(dt);
    // the commands, as page.c's records: the drawing's view of the same frame. Each carries its element's tree node, which
    // is what a group's range is cut by; a command that carries none (a scissor's derived pair) belongs to the last
    // element that had one, as the desktop's renderer decides it.
    command_count = 0;
    int32_t last_node = -1;
    for (int32_t i = 0; i < cmds.length && command_count < MAX_COMMANDS; i++) {
        const Clay_RenderCommand *rc = Clay_RenderCommandArray_Get(&cmds, i);
        const int32_t node = rc->userData ? (int32_t)(uintptr_t)rc->userData - 1 : -1;
        if (node >= 0) last_node = node;
        command_node[command_count] = last_node;
        WebCommand *c = &commands[command_count++];
        c->type = (int32_t)rc->commandType;
        c->id = (int32_t)rc->id;
        c->x = rc->boundingBox.x, c->y = rc->boundingBox.y;
        c->w = rc->boundingBox.width, c->h = rc->boundingBox.height;
        c->color = 0;
        for (int k = 0; k < 4; k++) c->radius[k] = 0, c->border[k] = 0;
        c->text = 0, c->textLength = 0, c->fontId = 0, c->fontSize = 0;
        switch (rc->commandType) {
        case CLAY_RENDER_COMMAND_TYPE_RECTANGLE: {
            c->color = pack(rc->renderData.rectangle.backgroundColor);
            c->radius[0] = rc->renderData.rectangle.cornerRadius.topLeft;
            c->radius[1] = rc->renderData.rectangle.cornerRadius.topRight;
            c->radius[2] = rc->renderData.rectangle.cornerRadius.bottomRight;
            c->radius[3] = rc->renderData.rectangle.cornerRadius.bottomLeft;
            break;
        }
        case CLAY_RENDER_COMMAND_TYPE_BORDER: {
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
        }
        case CLAY_RENDER_COMMAND_TYPE_TEXT: {
            c->color = pack(rc->renderData.text.textColor);
            c->text = (uint32_t)(uintptr_t)rc->renderData.text.stringContents.chars;
            c->textLength = (uint32_t)rc->renderData.text.stringContents.length;
            c->fontId = rc->renderData.text.fontId;
            c->fontSize = rc->renderData.text.fontSize;
            break;
        }
        case CLAY_RENDER_COMMAND_TYPE_IMAGE: {
            // the box is where the picture goes; its path rides in the record's text pair, which an image does not use
            // (the browser draws the picture out of the path, as the desktop's ThorVG loads it)
            const char *path = (const char *)rc->renderData.image.imageData;
            c->color = pack(rc->renderData.image.backgroundColor);
            c->text = (uint32_t)(uintptr_t)path;
            c->textLength = path ? (uint32_t)strlen(path) : 0;
            break;
        }
        default: break;
        }
    }
    settle_groups();
    hash_frame();
    return cmds.length;
}

// The frame's hash: FNV-1a over what a draw reads and nothing else — the commands, and the renderer tables beside them
// (a group's opacity can animate without moving one byte of the command array).
static uint64_t hash_bytes(uint64_t h, const void *p, size_t n)
{
    const unsigned char *b = p;
    for (size_t i = 0; i < n; i++) h = (h ^ b[i]) * 0x100000001b3ull;
    return h;
}

static uint64_t hash_u32(uint64_t h, uint32_t v) { return hash_bytes(h, &v, sizeof v); }

static uint64_t hash_f32(uint64_t h, float v)
{
    uint32_t bits;
    memcpy(&bits, &v, sizeof bits);
    return hash_u32(h, bits);
}

static uint64_t hash_color(uint64_t h, Clay_Color c)
{
    h = hash_f32(h, c.r), h = hash_f32(h, c.g), h = hash_f32(h, c.b);
    return hash_f32(h, c.a);
}

static uint64_t hash_corners(uint64_t h, Clay_CornerRadius c)
{
    h = hash_f32(h, c.topLeft), h = hash_f32(h, c.topRight);
    h = hash_f32(h, c.bottomRight);
    return hash_f32(h, c.bottomLeft);
}

static uint64_t hash_rect(uint64_t h, Clay_BoundingBox b)
{
    h = hash_f32(h, b.x), h = hash_f32(h, b.y), h = hash_f32(h, b.width);
    return hash_f32(h, b.height);
}

static void hash_frame(void)
{
    uint64_t h = 0xcbf29ce484222325ull;
    for (int32_t i = 0; i < cmds.length; i++) {
        const Clay_RenderCommand *c = &cmds.internalArray[i];
        h = hash_u32(h, (uint32_t)c->commandType);
        h = hash_u32(h, c->id);
        h = hash_rect(h, c->boundingBox);
        switch (c->commandType) {
        case CLAY_RENDER_COMMAND_TYPE_RECTANGLE:
            h = hash_color(h, c->renderData.rectangle.backgroundColor);
            h = hash_corners(h, c->renderData.rectangle.cornerRadius);
            break;
        case CLAY_RENDER_COMMAND_TYPE_BORDER:
            h = hash_color(h, c->renderData.border.color);
            h = hash_corners(h, c->renderData.border.cornerRadius);
            h = hash_u32(h, (uint32_t)c->renderData.border.width.left);
            h = hash_u32(h, (uint32_t)c->renderData.border.width.right);
            h = hash_u32(h, (uint32_t)c->renderData.border.width.top);
            h = hash_u32(h, (uint32_t)c->renderData.border.width.bottom);
            h = hash_u32(h, (uint32_t)c->renderData.border.width.betweenChildren);
            break;
        case CLAY_RENDER_COMMAND_TYPE_TEXT: {
            const Clay_StringSlice s = c->renderData.text.stringContents;
            h = hash_color(h, c->renderData.text.textColor);
            h = hash_u32(h, (uint32_t)c->renderData.text.fontId);
            h = hash_u32(h, (uint32_t)c->renderData.text.fontSize);
            h = hash_u32(h, (uint32_t)c->renderData.text.letterSpacing);
            h = hash_u32(h, (uint32_t)c->renderData.text.lineHeight);
            h = hash_u32(h, (uint32_t)(s.length > 0 ? s.length : 0));
            if (s.length > 0) h = hash_bytes(h, s.chars, (size_t)s.length);
            break;
        }
        case CLAY_RENDER_COMMAND_TYPE_SCISSOR_START:
        case CLAY_RENDER_COMMAND_TYPE_SCISSOR_END:
            h = hash_u32(h, c->renderData.clip.horizontal);
            h = hash_u32(h, c->renderData.clip.vertical);
            break;
        case CLAY_RENDER_COMMAND_TYPE_IMAGE: {
            const char *path = (const char *)c->renderData.image.imageData;
            h = hash_color(h, c->renderData.image.backgroundColor);
            h = hash_corners(h, c->renderData.image.cornerRadius);
            h = hash_u32(h, path ? (uint32_t)strlen(path) : 0);
            if (path) h = hash_bytes(h, path, strlen(path));
            break;
        }
        default: break;
        }
    }
    // the renderer's tables are what a draw reads beside the commands (a group's opacity moves no box)
    static const struct { const float *table; const int *count; int slots; } tables[] = {
        {shadow_table, &shadow_count, SHADOW_SLOTS},
        {backdrop_table, &backdrop_count, BACKDROP_SLOTS},
        {gradient_table, &gradient_count, GRADIENT_SLOTS},
        {group_table, &group_count, GROUP_SLOTS},
    };
    for (size_t t = 0; t < sizeof tables / sizeof *tables; t++) {
        h = hash_u32(h, (uint32_t)*tables[t].count);
        h = hash_bytes(h, tables[t].table, (size_t)*tables[t].count * (size_t)tables[t].slots * sizeof(float));
    }
    frame_hash = h;
}

/** The hash of the last frame's commands and its tables: the same value twice means the same pixels. */
EXPORT("ui_hash") uint64_t ui_hash(void) { return frame_hash; }

/** Draws of the page (ui_draw calls): the raster is JS's, so this is only the count a test reads. */
EXPORT("ui_draw") void ui_draw(void) { draw_count++; }

EXPORT("ui_draws") int32_t ui_draws(void) { return draw_count; }

/** The frames the host put on the canvas (the desktop's window present): the shell calls it once a paint. */
EXPORT("ui_present") void ui_present(void) { present_count++; }

EXPORT("ui_presents") int32_t ui_presents(void) { return present_count; }

// ---------- the frame as data: solid/src/dump.ts, the goldens in solid/goldens ----------

// the tables as clay_dump.c reads them, rebuilt from the float rows at a dump (the dump is a test's path, not a frame's)
static ClayDumpShadow dump_shadow_table[MAX_SHADOWS];
static ClayDumpBackdrop dump_backdrop_table[MAX_BACKDROPS];
static ClayDumpGradient dump_gradient_table[MAX_GRADIENTS];
static ClayDumpGroup dump_group_table[MAX_GROUPS];

static void dump_tables(void)
{
    for (int i = 0; i < shadow_count; i++) {
        const float *s = shadow_table + (size_t)i * SHADOW_SLOTS;
        uint32_t id;
        memcpy(&id, s, sizeof id);
        dump_shadow_table[i] = (ClayDumpShadow){.id = id, .x = s[1], .y = s[2], .blur = s[3],
                                           .color = (Clay_Color){s[4], s[5], s[6], s[7]}};
    }
    for (int i = 0; i < backdrop_count; i++) {
        const float *b = backdrop_table + (size_t)i * BACKDROP_SLOTS;
        uint32_t id;
        memcpy(&id, b, sizeof id);
        dump_backdrop_table[i] = (ClayDumpBackdrop){.id = id, .blur = b[1]};
    }
    for (int i = 0; i < gradient_count; i++) {
        const float *g = gradient_table + (size_t)i * GRADIENT_SLOTS;
        ClayDumpGradient *d = &dump_gradient_table[i];
        uint32_t id, kind, alpha, count;
        memcpy(&id, g, sizeof id), memcpy(&kind, g + 1, sizeof kind);
        memcpy(&alpha, g + 3, sizeof alpha), memcpy(&count, g + 4, sizeof count);
        *d = (ClayDumpGradient){.id = id, .kind = (int)kind, .angle = g[2], .alpha = (int)alpha, .count = (int)count};
        for (int k = 0; k < (int)count && k < CLAY_DUMP_MAX_STOPS; k++) {
            d->offset[k] = g[5 + k * 5];
            d->color[k] = (Clay_Color){g[6 + k * 5], g[7 + k * 5], g[8 + k * 5], g[9 + k * 5]};
        }
    }
    for (int i = 0; i < group_count; i++) {
        const float *g = group_table + (size_t)i * GROUP_SLOTS;
        uint32_t at, alpha;
        memcpy(&at, g, sizeof at), memcpy(&alpha, g + 3, sizeof alpha);
        dump_group_table[i] = (ClayDumpGroup){.at = (int32_t)at, .alpha = (int)alpha, .scale = g[4], .tx = g[5],
                                         .ty = g[6], .rotate = g[7]};
    }
}

/** The last frame as clay_dump.c's tables: the commands, the page's id strings, the text's own two fields, the renderer's
 *  tables beside them, and the tree a group's element is named by. */
static ClayDumpFrame dump_frame(void)
{
    dump_tables();
    return (ClayDumpFrame){
        .commands = cmds,
        .width = width,
        .height = height,
        .scale = 1,
        .hash = frame_hash,
        .names = id_names,
        .nameCount = id_name_count,
        .nodeIds = node_ids,
        .nodeCount = node_count,
        .textAlign = text_align,
        .textWrap = text_wrap,
        .textWeight = 0,
        .shadows = dump_shadow_table,
        .shadowCount = shadow_count,
        .backdrops = dump_backdrop_table,
        .backdropCount = backdrop_count,
        .gradients = dump_gradient_table,
        .gradientCount = gradient_count,
        .groups = dump_group_table,
        .groupCount = group_count,
    };
}

static char *dump_bytes;
static int32_t dump_length;

/** The last frame as JSON, replacing the previous one: its length, and its bytes at dump_ptr(). */
EXPORT("dump") int32_t ui_dump(void)
{
    const ClayDumpFrame frame = dump_frame();
    const ClayDump dump = Clay_DumpFrame(&frame);
    free(dump_bytes);
    dump_bytes = dump.bytes, dump_length = dump.length;
    return dump_length;
}

EXPORT("dump_ptr") char *ui_dump_bytes(void) { return dump_bytes; }

// ---- the console sink: the same cells the terminal draws, as a console.log call -------------------------------------

/** The last frame's commands as the terminal's cells (terminal/render.c): the rows, or 0 before a frame. */
EXPORT("ui_term_render") int32_t ui_term_render(void)
{
    const int cols = width / 8, rows = height / 16;
    if (!term_ready || term_grid.cols != cols || term_grid.rows != rows) {
        if (term_ready) cells_free(&term_grid);
        cells_init(&term_grid, cols, rows);
        term_ready = 1;
    }
    cells_clear(&term_grid);
    term_render(&term_grid, &cmds);
    return term_grid.rows;
}

/** The frame as the console call's JSON: mode 0 the whole frame, 1 the rows changed since the last mode 1, 2 the whole
 *  frame again (a test's broken sink). The rows written; the bytes at ui_term_console_ptr() for ui_term_console_len(). */
EXPORT("ui_term_console") int32_t ui_term_console(int32_t mode)
{
    if (!term_ready) return 0;
    const int written = cells_console_text(&term_grid, mode == 1 && term_prev_ok ? &term_prev : NULL, &term_text);
    if (mode == 1) {
        if (term_prev_ok) cells_free(&term_prev);
        cells_copy(&term_prev, &term_grid);
        term_prev_ok = 1;
    }
    return written;
}
EXPORT("ui_term_console_ptr") char *ui_term_console_bytes(void) { return term_text.bytes; }
EXPORT("ui_term_console_len") int32_t ui_term_console_size(void) { return term_text.len; }

EXPORT("cmd_count") int32_t ui_command_count(void) { return command_count; }
EXPORT("cmd_size") int32_t ui_command_size(void) { return (int32_t)sizeof(WebCommand); }
EXPORT("cmds") WebCommand *ui_commands(void) { return commands; }

/** The box of the element with that id, in the layout of the last frame, into out[4] (x, y, w, h); 0 when there is no
 *  such element. */
EXPORT("ui_bounds") int32_t ui_bounds(const char *id, int32_t len, float *out)
{
    const Clay_ElementData d = Clay_GetElementData(Clay__HashString(slice(id, len), 0));
    if (!d.found) return 0;
    out[0] = d.boundingBox.x, out[1] = d.boundingBox.y, out[2] = d.boundingBox.width;
    out[3] = d.boundingBox.height;
    return 1;
}

/** The scroll offset of the clip element with that id along `axis` (0 y, 1 x); 0 when there is none. */
EXPORT("ui_scroll_offset") float ui_scroll_offset(const char *id, int32_t len, int32_t axis)
{
    const Clay_ScrollContainerData d = Clay_GetScrollContainerData(Clay__HashString(slice(id, len), 0));
    if (!d.found) return 0;
    return axis ? d.scrollPosition->x : d.scrollPosition->y;
}

/** Scrolls the clip element with that id to `v` on `axis`, clamped to its content; the offset it took. */
EXPORT("ui_scroll_to") float ui_scroll_to(const char *id, int32_t len, int32_t axis, float v)
{
    const Clay_ScrollContainerData d = Clay_GetScrollContainerData(Clay__HashString(slice(id, len), 0));
    if (!d.found) return 0;
    if (axis) {
        const float lowest = -fmaxf(d.contentDimensions.width - d.scrollContainerDimensions.width, 0);
        d.scrollPosition->x = fminf(fmaxf(v, lowest), 0);
        return d.scrollPosition->x;
    }
    const float lowest = -fmaxf(d.contentDimensions.height - d.scrollContainerDimensions.height, 0);
    d.scrollPosition->y = fminf(fmaxf(v, lowest), 0);
    return d.scrollPosition->y;
}

/** Puts a clip element's offset where the page says, past its content too: a rubber band's overscroll. */
EXPORT("ui_scroll_put") float ui_scroll_put(const char *id, int32_t len, int32_t axis, float v)
{
    const Clay_ScrollContainerData d = Clay_GetScrollContainerData(Clay__HashString(slice(id, len), 0));
    if (!d.found) return 0;
    if (axis) d.scrollPosition->x = v;
    else d.scrollPosition->y = v;
    return v;
}

/** A finger's position, normalised (0..1) in the layout's pixels: the desktop's mapping, for a page that takes a touch. */
EXPORT("ui_touch_map") void ui_touch_map(float fx, float fy, float *out)
{
    out[0] = fx * width;
    out[1] = fy * height;
}
