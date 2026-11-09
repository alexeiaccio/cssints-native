// Clay + ThorVG's software raster + an SDL3 window behind flat C functions, for bun:ffi: no struct crosses the
// boundary. A style is a packed float array (the field order is in solid/README.md and mirrored in src/pack.ts), a
// string is a pointer and a length. One frame from JS: ui_begin, ui_open / ui_text / ui_close in tree order, ui_end.
#define CLAY_IMPLEMENTATION
#include "clay.h"

#include <SDL3/SDL.h>
#include <SDL3_image/SDL_image.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../../desktop/clay_renderer_thorvg.c"
#include "../../desktop/clay_dump.c" // ui_dump_json: the frame as JSON, the one emitter every host dumps through
#ifdef CLAY_THORVG_WG
#include "../../desktop/thorvg_wg.c" // --raster thorvg-gpu: the WebGPU canvas and its readback
#else
typedef struct { int unused; } Clay_WgTarget; // only the GPU build (desktop/build-thorvg-gpu.sh solid)
#endif

#define MAX_FONTS 8
#define ARENA_SIZE (1 << 16)
// a style is a compile-time literal (solid/plugin.ts packs it once), so the only way one of its numbers moves between
// frames is the value channel: a page's per-frame overrides of a packed style, by element id
#define STYLE_FIELDS 45
// a text's fields (solid/README.md): its colour, font, size, spacing, line height, alignment and wrap. Its colour is
// here, not in the parent's box, so the box's overrides cannot reach it: ui_text reads the four fields below itself
#define TEXT_FIELDS 10
#define FIELD_SHADOW_BLUR 45 // the one value outside the 45 floats: the blur of the element's shadow (a renderer table)
// ... and four more that are not in the floats either: the element's whole subtree as one scene. ALPHA is that scene's
// opacity (0..255), so a text over its own fill fades as a group; SCALE is a scale about the element's box centre
// (1 = none); TRANSLATE_X/Y are a visual offset of the whole subtree (px). None of them is a layout: `ui_bounds` does
// not move as any of them animates
#define FIELD_ALPHA 46
#define FIELD_SCALE 47
#define FIELD_TRANSLATE_X 48
#define FIELD_TRANSLATE_Y 49
// ... and the opacity of the element's own background image (a gradient), so a page can fade one in or out: at 255 it is
// drawn alone, as an opaque gradient is; below it, it is composited over the element's solid fill
#define FIELD_GRADIENT_ALPHA 50
// ... and four floats that are not a box's at all: the colour of a text element (its own fields 0..3), reachable only
// through the text's id, since a text has no box of its own to hold them. A text without an id cannot be named, so its
// colour is its style's literal and cannot be animated
#define FIELD_TEXT_COLOR_R 51
#define FIELD_TEXT_COLOR_G 52
#define FIELD_TEXT_COLOR_B 53
#define FIELD_TEXT_COLOR_A 54
// ... and the rotation of an element's whole subtree in degrees, about its box centre, beside the scale and the
// translate of the same scene (one matrix: scale, then rotate, then translate; see Clay_ThorVG_SettleGroup)
#define FIELD_ROTATE 55

static Clay_ThorVGRendererData tvg;
static const char *font_names[MAX_FONTS];
static int font_count, width, height, errors;
static Uint32 *pixels;
static Clay_RenderCommandArray cmds;
// text lives here for the frame: Clay keeps the pointer until the render pass
static char arena[ARENA_SIZE];
static int arena_used;

// image paths: a Clay image's config is one pointer (`imageData`), and the renderer caches a picture by that pointer, so
// one path must arrive as one address every frame. Interned on first use and kept for the process.
// A photo grid scrolls past thousands of distinct pictures, so the interned paths grow: a fixed table dropped the
// 65th path for good, and its cell drew blank forever. Strings are kept for the process, compared by content.
static const char **image_paths;
static uint32_t *image_hashes;
static int image_count, image_cap;
static const char *pending_image;
// the shadow (css.shadow) the next ui_open declares: Clay has no shadow field, so it rides the renderer's table instead
static float pending_shadow[3];
static Clay_Color pending_shadow_color;
static int has_pending_shadow;
// the backdrop (css.backdrop) the next ui_open declares: the renderer blurs the pixels under that element
static float pending_backdrop = -1;
// the background image (css.backgroundImage) the next ui_open declares: a linear gradient, 8 stops at most
#define MAX_GRADIENT_STOPS 8
static struct {
    int kind;  // 1: linear (the only one cssints/clay writes)
    float angle;
    int count;
    float stops[MAX_GRADIENT_STOPS][5]; // offset (0..1), then r, g, b, a 0-255
} pending_gradient;
static int has_pending_gradient;
// the value channel: this frame's overrides of a packed style, by element id, written by the page's tick (after
// `ui_begin`, before the tree is declared) and read by `ui_open`. A figure's item writes three values (a FIXED width's
// type, min and max), so a multi-row figure of twenty items is sixty; the tree's levels are the first page to pass 64,
// and a palette of two hues' thirteen steps is a step a row of five items, 429 — the same 1,024 the terminal's table has
// (solid/native/term.c), so a figure cannot draw on one target and be refused on another.
#define MAX_VALUES 1024
static struct {
    uint32_t id;
    uint16_t field;
    float value;
} values[MAX_VALUES];
static int value_count;

// what the last ui_end hashed: a settled frame hashes the same as the frame before it, so the host can skip the draw
// and the present. It is filled in ui_end, not by ui_hash, so it survives a draw (which may write its tables' `drawn`)
static uint64_t frame_hash = 0xcbf29ce484222325ull;
// ui_draw and ui_window_present calls of the process, for a test: a page at rest keeps both still
static int draw_count, present_count;

// the element names of the frame, by Clay's 32-bit id: `ui_dump_json` turns a command's id back into the page's id
// string, and a text's node is where its alignment and wrap are kept (Clay's text command carries the colour and the
// font but not those two, which the layout consumed). Both are interned per node in ui_open / ui_text.
static unsigned char text_align[CLAY_THORVG_MAX_TREE], text_wrap[CLAY_THORVG_MAX_TREE];
// ponytail: 512 named elements a page (ui_init starts the table over); later ids are unnamed in a dump (a page's
// ids are the same every frame)
#define MAX_ID_NAMES 512
static ClayDumpName id_names[MAX_ID_NAMES];
static int id_name_count;

static SDL_Window *window;
static SDL_Renderer *renderer;
static SDL_Texture *texture;
static Clay_WgTarget wg; // the WebGPU device and texture, when the canvas is ThorVG's WebGPU one
static int gpu;          // 0: the software canvas; 1: the WebGPU canvas, the frame read back into pixels

// the wheel the polls took, in Clay's units (positive scrolls the content down, the wheel up), for the next ui_begin
static float wheel_x, wheel_y;
// ... and the same delta for the page: `ui_wheel_pop` drains it (a page that scrolls itself reads it, so it sees a notch
// even while `ui_begin` leaves Clay's containers alone)
static float page_wheel_x, page_wheel_y;
// whether `ui_begin` feeds the wheel to Clay's scroll containers (the default); a page that animates its own offset
// turns it off, so the same notch is not applied twice
static int auto_scroll = 1;

/** Adds a wheel delta to the next frame, in Clay's units: positive scrolls the content down, as SDL's wheel y. */
void ui_wheel(float dx, float dy)
{
    wheel_x += dx, wheel_y += dy;
    page_wheel_x += dx, page_wheel_y += dy;
}

/** The wheel the polls (or the headless `ui_wheel` calls) took since the last pop into out[2], drained; 0 when there is
 *  none. The delta is SDL's: positive y is away from the user. */
int ui_wheel_pop(float *out)
{
    if (page_wheel_x == 0 && page_wheel_y == 0) return 0;
    out[0] = page_wheel_x, out[1] = page_wheel_y;
    page_wheel_x = page_wheel_y = 0;
    return 1;
}

/** Turns Clay's own wheel scrolling on (1, the default) or off (0): a page that scrolls itself owns the offset. */
void ui_auto_scroll(int on) { auto_scroll = on != 0; }

static void on_error(Clay_ErrorData e)
{
    errors++;
    fprintf(stderr, "clay error %d: %.*s\n", (int)e.errorType, (int)e.errorText.length, e.errorText.chars);
}

/** (Re)allocates the pixel buffer for the scale and points the canvas at it. */
static int retarget(float scale)
{
    const int tw = (int)(width * scale), th = (int)(height * scale);
    free(pixels);
    pixels = malloc((size_t)tw * th * 4);
    tvg.scale = scale;
    // the CPU blur of a backdrop (css.backdrop) works on this buffer; the WebGPU canvas has none until its readback
    tvg.target = NULL;
    if (gpu) {
#ifdef CLAY_THORVG_WG
        // ponytail: a new device and texture on every retarget (init, then the window's scale); the old one is left to
        // the process, which exits with it
        if (!Clay_Wg_Create(&wg, tw, th)) return 1;
        return tvg_wgcanvas_set_target(tvg.canvas, wg.device, wg.instance, wg.texture, tw, th, TVG_COLORSPACE_ABGR8888, 1);
#else
        return 1;
#endif
    }
    tvg.target = pixels, tvg.targetWidth = tw, tvg.targetHeight = th;
    return tvg_swcanvas_set_target(tvg.canvas, pixels, tw, tw, th, TVG_COLORSPACE_ABGR8888);
}

/** Starts Clay and a ThorVG canvas of w x h; 0 on success. `want_gpu` picks the WebGPU canvas over the software one. */
static int init(int w, int h, int want_gpu)
{
    width = w, height = h;
    // a page's ids start empty: ui_init is a new page (the golden test captures every spec in one process, and the dump
    // names only what this page declared), and the names are ours to free
    for (int i = 0; i < id_name_count; i++) free(id_names[i].name);
    id_name_count = 0;
    uint32_t size = Clay_MinMemorySize();
    Clay_Initialize(Clay_CreateArenaWithCapacityAndMemory(size, malloc(size)), (Clay_Dimensions){w, h},
                    (Clay_ErrorHandler){on_error});
    tvg.fonts = font_names;
    if (tvg_engine_init(0)) return 1;
    gpu = want_gpu;
    if (gpu) {
#ifdef CLAY_THORVG_WG
        if (!(tvg.canvas = tvg_wgcanvas_create(TVG_ENGINE_OPTION_DEFAULT))) return 1;
#else
        fprintf(stderr, "thorvg-gpu: this libui has no WebGPU engine (desktop/build-thorvg-gpu.sh solid)\n");
        return 1;
#endif
    } else if (!(tvg.canvas = tvg_swcanvas_create(TVG_ENGINE_OPTION_DEFAULT))) {
        return 1;
    }
    if (retarget(1)) return 1;
    tvg.measurer = tvg_text_new();
    Clay_SetMeasureTextFunction(Clay_ThorVG_MeasureText, &tvg);
    return 0;
}

int ui_init(int w, int h) { return init(w, h, 0); }

/** The raster's pixel density, as the window's is (SDL's density: 2 on a Retina screen) and headless 1: the same layout
 *  drawn into that many more pixels. The text oracle measures 2, which is what a window on this Mac actually draws. */
int ui_density(float scale) { return retarget(scale > 0.5f ? scale : 1); }

/** The same page on ThorVG's WebGPU canvas (wgpu-native on Metal), its frames read back into the same buffer. */
int ui_init_gpu(int w, int h) { return init(w, h, 1); }

/** Loads a font file; its id is the order of the calls. ThorVG names a font by its file name without extension. */
int ui_font(const char *path)
{
    if (font_count == MAX_FONTS || tvg_font_load(path)) return -1;
    const char *base = strrchr(path, '/');
    base = base ? base + 1 : path;
    const char *dot = strrchr(base, '.');
    font_names[font_count] = strndup(base, dot ? (size_t)(dot - base) : strlen(base));
    return font_count++;
}

int ui_errors(void) { return errors; }

static Clay_String slice(const char *s, int len) { return (Clay_String){.length = len, .chars = s}; }

/** Pointer position and button for this frame, then Clay opens the layout. `dt` is the frame's elapsed seconds (Clay's
 *  scroll momentum step). */
void ui_begin(float px, float py, int down, float dt)
{
    arena_used = 0;
    pending_image = NULL;
    has_pending_shadow = 0;
    pending_backdrop = -1;
    has_pending_gradient = 0;
    value_count = 0; // the value channel is a frame's, as the shadows and the backdrops are
    tvg.treeCount = 0; // ... and so is the element tree and its groups
    tvg.openDepth = 0;
    tvg.groupCount = 0;
    tvg.shadowCount = 0; // the frame's shadows go with the rest of the frame
    tvg.backdropCount = 0;
    tvg.gradientCount = 0;
    Clay_SetPointerState((Clay_Vector2){px, py}, down);
    // Clay's scroll containers: the wheel delta of the polls moves the container the pointer is over, before the layout
    // reads the offsets (ui_open hands each clip element its own through Clay_GetScrollOffset). No drag scrolling:
    // Clay's drag leaves a momentum of ~17x a short drag, and its container clamps any overscroll it is given, so the
    // pages that drag write the offset themselves (the Sky feed's own track, the List's through `ui_scroll_to`). A page
    // that owns its offset (ui_auto_scroll(0)) has already taken the delta through ui_wheel_pop, so the drain still
    // happens and Clay moves nothing.
    if (auto_scroll) Clay_UpdateScrollContainers(0, (Clay_Vector2){wheel_x, wheel_y}, dt);
    wheel_x = 0, wheel_y = 0;
    Clay_BeginLayout();
}

/** True when the pointer is over the element of that id in the layout of the last frame. */
int ui_pointer_over(const char *id, int len) { return Clay_PointerOver(Clay__HashString(slice(id, len), 0)); }

static Clay_SizingAxis axis(const float *f)
{
    Clay_SizingAxis a = {0};
    a.type = (Clay__SizingType)f[0]; // 0 FIT, 1 GROW, 2 PERCENT, 3 FIXED: Clay's own order
    if (a.type == CLAY__SIZING_TYPE_PERCENT) a.size.percent = f[1];
    else a.size.minMax.min = f[1], a.size.minMax.max = f[2];
    return a;
}

static Clay_Color color(const float *f) { return (Clay_Color){f[0], f[1], f[2], f[3]}; }

/** The image the next ui_open declares: the path of the picture, interned. Clay's image config is that pointer and the
 *  renderer keys its picture on it, so the same path must have the same address every frame (a per-frame copy would
 *  load the file again each frame and fill the renderer's cache). */
void ui_image(const char *path, int len)
{
    // the hash is a cheap reject before the length and byte compares; the table only ever grows
    uint32_t h = 2166136261u;
    for (int i = 0; i < len; i++) h = (h ^ (unsigned char)path[i]) * 16777619u;
    for (int i = 0; i < image_count; i++)
        if (image_hashes[i] == h && (int)strlen(image_paths[i]) == len &&
            memcmp(image_paths[i], path, (size_t)len) == 0) {
            pending_image = image_paths[i];
            return;
        }
    if (image_count == image_cap) {
        int cap = image_cap ? image_cap * 2 : 64;
        const char **paths = realloc(image_paths, sizeof *paths * (size_t)cap);
        if (!paths) { errors++; return; }
        image_paths = paths;
        uint32_t *hashes = realloc(image_hashes, sizeof *hashes * (size_t)cap);
        if (!hashes) { errors++; return; }
        image_hashes = hashes;
        image_cap = cap;
    }
    image_hashes[image_count] = h;
    image_paths[image_count] = strndup(path, (size_t)len);
    pending_image = image_paths[image_count++];
}

/** The shadow of the next element (a css.shadow style): the element's box moved by x and y, blurred by blur, in that
 *  colour. Clay has no shadow field, so this is a renderer effect keyed by the element's id. */
void ui_shadow(float x, float y, float blur, float r, float g, float b, float a)
{
    pending_shadow[0] = x, pending_shadow[1] = y, pending_shadow[2] = blur;
    pending_shadow_color = (Clay_Color){r, g, b, a};
    has_pending_shadow = 1;
}

/** The backdrop of the next element (a css.backdrop style): the pixels under its box are blurred, then the element is
 *  drawn over them, so a translucent fill is glass over what is behind it. A renderer effect, as the shadow. */
void ui_backdrop(float blur) { pending_backdrop = blur; }

/** The background image of the next element (a css.backgroundImage style): a linear gradient at `angle` degrees in CSS's
 *  reading (0 up, 90 right), `count` stops of (offset 0..1, r, g, b, a) each, flattened. A renderer effect, as the shadow:
 *  the renderer fills the element's box with it instead of its solid background. */
void ui_backgroundImage(int kind, float angle, int count, const float *stops)
{
    // ponytail: 8 stops a gradient, one gradient an element; a ninth is counted as an error and dropped
    if (count > MAX_GRADIENT_STOPS) errors++, count = MAX_GRADIENT_STOPS;
    if (count < 2) errors++;
    pending_gradient.kind = kind, pending_gradient.angle = angle, pending_gradient.count = count;
    memcpy(pending_gradient.stops, stops, (size_t)count * 5 * sizeof(float));
    has_pending_gradient = 1;
}

/** An override of one number of the style of the element with that id, for this frame only: field 0..44 is a packed
 *  field (their order in solid/README.md), 45 is the blur of the element's shadow, 46 the opacity of its whole subtree,
 *  47 a scale about its box centre, 48/49 a visual offset of it in x and y, and 50 the opacity of its background image.
 *  51..54 are the colour of the text element with that id (its own floats, not its box's; a text without an id cannot be
 *  named) and 55 the rotation of an element's subtree in degrees, about its box centre.
 *  `ui_open` copies the element's own floats,
 *  applies the overrides of its id and declares from the copy, so the style's literal is what it falls back to (a track
 *  that settles on the style's own value leaves the frame identical). Out of range, or past 64 a frame, is counted as an
 *  error and dropped. Width, height, padding, gap and the colours are Clay's layout and its fill: they are legal but a
 *  moving one re-lays-out its parent's box, so an offset, a blur or the group is what reads as motion. */
void ui_value(const char *id, int len, int field, float value)
{
    // ponytail: 128 overrides a frame (a figure with twenty items needs sixty); more needs a bigger table
    if (field < 0 || field > FIELD_ROTATE || value_count == MAX_VALUES) {
        errors++;
        return;
    }
    values[value_count].id = Clay__HashString(slice(id, len), 0).id;
    values[value_count].field = (uint16_t)field;
    values[value_count].value = value;
    value_count++;
}

// The page's id string of an element, kept by Clay's hash of it: a dump names a command's element from it. The name is
// the page's, so it does not change between frames, and one name a hash is enough (two elements cannot share an id
// without Clay confusing them too).
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

/** Opens an element. id is NULL for an anonymous one; f is 45 floats: the box fields, then the floating ones. */
void ui_open(const char *id, int len, const float *style)
{
    static const Clay_LayoutAlignmentX ax[3] = {CLAY_ALIGN_X_LEFT, CLAY_ALIGN_X_CENTER, CLAY_ALIGN_X_RIGHT};
    static const Clay_LayoutAlignmentY ay[3] = {CLAY_ALIGN_Y_TOP, CLAY_ALIGN_Y_CENTER, CLAY_ALIGN_Y_BOTTOM};
    Clay_ElementId eid = {0};
    if (id) eid = Clay__HashString(slice(id, len), 0);
    if (id) intern_id(eid.id, id, len);
    // the value channel (ui_value): this element's overrides, applied to a copy of its own floats. Without one the
    // declaration reads the style's literal, so a frame that uses no channel is the frame it was (180 bytes copied for
    // an element that has an override, nothing for one that does not)
    float over[STYLE_FIELDS];
    const float *f = style;
    float shadow_blur = -1;
    int alpha = 255, grouped = 0;
    float scale = 1, tx = 0, ty = 0, rotate = 0;
    float gradient_alpha = 255;
    if (id && value_count) {
        int mine = 0;
        for (int i = 0; i < value_count; i++) mine += values[i].id == eid.id;
        if (mine) {
            memcpy(over, style, sizeof over);
            for (int i = 0; i < value_count; i++) {
                if (values[i].id != eid.id) continue;
                if (values[i].field == FIELD_SHADOW_BLUR) shadow_blur = values[i].value;
                // the group fields are not floats of the style: they go to the renderer's table, as the shadow's blur
                else if (values[i].field == FIELD_ALPHA) alpha = (int)(values[i].value + 0.5f), grouped = 1;
                else if (values[i].field == FIELD_SCALE) scale = values[i].value, grouped = 1;
                else if (values[i].field == FIELD_TRANSLATE_X) tx = values[i].value, grouped = 1;
                else if (values[i].field == FIELD_TRANSLATE_Y) ty = values[i].value, grouped = 1;
                else if (values[i].field == FIELD_ROTATE) rotate = values[i].value, grouped = 1;
                else if (values[i].field == FIELD_GRADIENT_ALPHA) gradient_alpha = values[i].value;
                // 51..54 are a text's, not a box's: ui_text reads them, and they would be past the end of these floats
                else if (values[i].field < STYLE_FIELDS) over[values[i].field] = values[i].value;
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
        d.floating.attachPoints = (Clay_FloatingAttachPoints){
            (Clay_FloatingAttachPointType)(int)f[36], (Clay_FloatingAttachPointType)(int)f[37]};
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
    // the style's shadow (css.shadow), set by ui_shadow just before this call: the renderer keys it by the element's
    // 32-bit id hash, which is also what its commands carry. An anonymous element has no id to key it by.
    if (has_pending_shadow) {
        if (id)
            Clay_ThorVG_SetShadow(&tvg, eid.id, pending_shadow[0], pending_shadow[1],
                                  shadow_blur >= 0 ? shadow_blur : pending_shadow[2], pending_shadow_color);
        has_pending_shadow = 0;
    }
    // ... and its backdrop (css.backdrop): the renderer cuts the frame there, blurs the element's box and carries on
    if (pending_backdrop >= 0) {
        if (id) Clay_ThorVG_SetBackdrop(&tvg, eid.id, pending_backdrop);
        pending_backdrop = -1;
    }
    // ... and its gradient (css.backgroundImage): the renderer fills the element's box with it, over its shadow
    if (has_pending_gradient) {
        if (id)
            Clay_ThorVG_SetBackgroundImage(&tvg, eid.id, pending_gradient.kind, pending_gradient.angle,
                                           pending_gradient.count, pending_gradient.stops, gradient_alpha);
        has_pending_gradient = 0;
    }
    if (id) Clay__OpenElementWithId(eid);
    else Clay__OpenElement();
    // The frame's element tree, in declaration order: the node's parent is the element that was open before it. Clay
    // gives an anonymous element an id of its own on open, so it is read back after; the node's index is what the
    // commands carry (userData) and what a group names, so an anonymous element is a parent like any other. A text
    // (ui_text) is a node too, since a group's subtree must reach the text inside it.
    if (tvg.treeCount < CLAY_THORVG_MAX_TREE) {
        Clay_LayoutElement *open = Clay__GetOpenLayoutElement();
        const int32_t node = tvg.treeCount++;
        tvg.tree[node].id = open->id;
        tvg.tree[node].parent = tvg.openDepth ? tvg.open[tvg.openDepth - 1] : -1;
        d.userData = (void *)(uintptr_t)(node + 1);
        if (grouped) Clay_ThorVG_SetGroup(&tvg, node, alpha, scale, tx, ty, rotate);
        // ponytail: CLAY_THORVG_MAX_DEPTH elements deep; a deeper page keeps the deepest parent it recorded
        if (tvg.openDepth < CLAY_THORVG_MAX_DEPTH) tvg.open[tvg.openDepth++] = node;
    } else errors++; // ponytail: CLAY_THORVG_MAX_TREE elements a frame; a deeper page needs a bigger tree
    // a clip element is a scroll container: the offset Clay kept for it across frames is what shifts its children (its
    // debug view feeds its own the same way). Before Clay__ConfigureOpenElement, which reads this declaration.
    if (d.clip.horizontal || d.clip.vertical) d.clip.childOffset = Clay_GetScrollOffset();
    Clay__ConfigureOpenElement(d);
}

void ui_close(void)
{
    Clay__CloseElement();
    if (tvg.openDepth) tvg.openDepth--;
}

/** A text element, with an id or NULL for an anonymous one. A text's colour is its own four floats, not its parent's
 *  box, so it is the value channel's second kind of target: with an id, fields 51..54 of that id override the colour of
 *  its copy of the 10 floats (a label fading from muted to accent). Without an id nothing can name the text, so it is
 *  its style's literal — a text without an id cannot be animated. The bytes are copied for the frame. */
void ui_text(const char *id, int id_len, const char *s, int len, const float *f)
{
    static const Clay_TextAlignment al[3] = {CLAY_TEXT_ALIGN_LEFT, CLAY_TEXT_ALIGN_CENTER, CLAY_TEXT_ALIGN_RIGHT};
    static const Clay_TextElementConfigWrapMode wm[3] = {CLAY_TEXT_WRAP_WORDS, CLAY_TEXT_WRAP_NEWLINES,
                                                         CLAY_TEXT_WRAP_NONE};
    // ponytail: 64 KB of text a frame; a longer page needs a bigger arena
    if (arena_used + len > ARENA_SIZE) {
        errors++;
        return;
    }
    char *copy = arena + arena_used;
    memcpy(copy, s, len);
    arena_used += len;
    Clay_ElementId eid = {0};
    float over[TEXT_FIELDS];
    const float *tf = f;
    if (id) {
        eid = Clay__HashString(slice(id, id_len), 0);
        intern_id(eid.id, id, id_len);
        // the value channel (ui_value): this text's colour overrides, applied to a copy of its own floats. Only the
        // colour: the font, the size and the rest stay the style's literal
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
    // the text's node in the frame's tree: Clay derives a text element's id from the parent and its place among the
    // parent's children (the expression below is the one Clay__OpenTextElement uses), and it is the id its commands
    // carry. A page cannot turn a text into a group, but a group's subtree must reach through it; a text with an id of
    // its own is named by it (the id is what the colour's overrides are keyed by).
    if (tvg.treeCount < CLAY_THORVG_MAX_TREE) {
        Clay_LayoutElement *parent = Clay__GetOpenLayoutElement();
        const int32_t node = tvg.treeCount++;
        tvg.tree[node].id =
            id ? eid.id : Clay__HashNumber(parent->children.length + parent->floatingChildrenCount, parent->id).id;
        tvg.tree[node].parent = tvg.openDepth ? tvg.open[tvg.openDepth - 1] : -1;
        c.userData = (void *)(uintptr_t)(node + 1);
        // the two fields of the text's config that Clay's command does not carry: the dump reads them by the node
        text_align[node] = (unsigned char)tf[8], text_wrap[node] = (unsigned char)tf[9];
    } else errors++;
    Clay__OpenTextElement(slice(copy, len), c);
}

static void hash_frame(void);

/** Closes the layout: Clay computes the boxes. Returns the command count, and hashes the frame for `ui_hash`. */
int ui_end(float dt)
{
    cmds = Clay_EndLayout(dt);
    hash_frame();
    return cmds.length;
}

// The frame's hash: FNV-1a over what a draw reads, and nothing else. A frame whose hash is the same as the last one
// draws the same pixels, so the host may draw and present it not at all. The command array carries the types, the
// element ids, the boxes, the colours, the corner radii, the border widths and, per type, the text (its bytes, colour,
// font and size), an image's pointer, a clip's axes or a custom's pointer. The renderer's tables ride beside the
// commands (css.shadow, css.backdrop, css.backgroundImage and the value channel's group), so they are hashed too:
// a shadow's blur or a group's opacity can animate without moving one byte of the command array.
static uint64_t hash_bytes(uint64_t h, const void *p, size_t n)
{
    const unsigned char *b = p;
    for (size_t i = 0; i < n; i++) h = (h ^ b[i]) * 0x100000001b3ull;
    return h;
}

static uint64_t hash_u32(uint64_t h, uint32_t v) { return hash_bytes(h, &v, sizeof v); }

// a float by its bit pattern: -0 and 0 are two frames here, which costs a draw and never skips one
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
            h = hash_u32(h, c->renderData.border.width.left), h = hash_u32(h, c->renderData.border.width.right);
            h = hash_u32(h, c->renderData.border.width.top), h = hash_u32(h, c->renderData.border.width.bottom);
            h = hash_u32(h, c->renderData.border.width.betweenChildren);
            break;
        case CLAY_RENDER_COMMAND_TYPE_TEXT: {
            const Clay_StringSlice s = c->renderData.text.stringContents;
            h = hash_color(h, c->renderData.text.textColor);
            h = hash_u32(h, c->renderData.text.fontId), h = hash_u32(h, c->renderData.text.fontSize);
            h = hash_u32(h, c->renderData.text.letterSpacing), h = hash_u32(h, c->renderData.text.lineHeight);
            h = hash_u32(h, (uint32_t)(s.length > 0 ? s.length : 0));
            if (s.length > 0) h = hash_bytes(h, s.chars, (size_t)s.length);
            break;
        }
        case CLAY_RENDER_COMMAND_TYPE_IMAGE:
            h = hash_color(h, c->renderData.image.backgroundColor);
            h = hash_corners(h, c->renderData.image.cornerRadius);
            h = hash_bytes(h, &c->renderData.image.imageData, sizeof c->renderData.image.imageData);
            break;
        case CLAY_RENDER_COMMAND_TYPE_SCISSOR_START:
        case CLAY_RENDER_COMMAND_TYPE_SCISSOR_END:
            h = hash_u32(h, c->renderData.clip.horizontal);
            h = hash_u32(h, c->renderData.clip.vertical);
            break;
        case CLAY_RENDER_COMMAND_TYPE_OVERLAY_COLOR_START:
        case CLAY_RENDER_COMMAND_TYPE_OVERLAY_COLOR_END:
            h = hash_color(h, c->renderData.overlayColor.color);
            break;
        case CLAY_RENDER_COMMAND_TYPE_CUSTOM:
            h = hash_color(h, c->renderData.custom.backgroundColor);
            h = hash_corners(h, c->renderData.custom.cornerRadius);
            h = hash_bytes(h, &c->renderData.custom.customData, sizeof c->renderData.custom.customData);
            break;
        default: break;
        }
    }
    // the renderer's effects: a shadow, a backdrop, a gradient, a subtree's scene, and the text weight every line is drawn
    // with (a host may set it between frames, and a thicker line is other pixels)
    h = hash_f32(h, tvg.textWeight);
    for (int i = 0; i < tvg.shadowCount; i++) {
        const Clay_Color color = tvg.shadows[i].color;
        h = hash_u32(h, tvg.shadows[i].id);
        h = hash_f32(h, tvg.shadows[i].x), h = hash_f32(h, tvg.shadows[i].y);
        h = hash_f32(h, tvg.shadows[i].blur);
        h = hash_color(h, color);
    }
    for (int i = 0; i < tvg.backdropCount; i++) {
        h = hash_u32(h, tvg.backdrops[i].id);
        h = hash_f32(h, tvg.backdrops[i].blur);
    }
    for (int i = 0; i < tvg.gradientCount; i++) {
        h = hash_u32(h, tvg.gradients[i].id), h = hash_u32(h, (uint32_t)tvg.gradients[i].kind);
        h = hash_f32(h, tvg.gradients[i].angle);
        h = hash_u32(h, (uint32_t)tvg.gradients[i].count), h = hash_u32(h, (uint32_t)tvg.gradients[i].alpha);
        for (int k = 0; k < tvg.gradients[i].count; k++) {
            h = hash_f32(h, tvg.gradients[i].offset[k]);
            h = hash_color(h, tvg.gradients[i].color[k]);
        }
    }
    for (int i = 0; i < tvg.groupCount; i++) {
        // a group at alpha 255, scale 1, no offset and no rotation is a scene that draws what it would have drawn
        // without one (the renderer skips it too): the page may still declare it, a track that has just landed, and its
        // arrival or departure is not a frame
        if (tvg.groups[i].alpha >= 255 && tvg.groups[i].scale == 1 && tvg.groups[i].tx == 0 && tvg.groups[i].ty == 0 &&
            tvg.groups[i].rotate == 0)
            continue;
        h = hash_u32(h, (uint32_t)tvg.groups[i].at), h = hash_u32(h, (uint32_t)tvg.groups[i].alpha);
        h = hash_f32(h, tvg.groups[i].scale), h = hash_f32(h, tvg.groups[i].tx);
        h = hash_f32(h, tvg.groups[i].ty), h = hash_f32(h, tvg.groups[i].rotate);
    }
    frame_hash = h;
}

/** The hash of the last frame's commands and renderer effects: the same value twice means the same pixels. */
uint64_t ui_hash(void) { return frame_hash; }

// ---------- the frame as data: solid/src/dump.ts, the goldens in solid/goldens ----------

// The frame as JSON lives in desktop/clay_dump.c: one emitter for this host, the C page on the desktop and the wasm in
// the browser. This host is the one with every table (the names, the text's own two fields, the renderer's effects).
static uint32_t dump_node_ids[CLAY_THORVG_MAX_TREE];
static ClayDumpShadow dump_shadow_table[32];
static ClayDumpBackdrop dump_backdrop_table[8];
static ClayDumpGradient dump_gradient_table[16];
static ClayDumpGroup dump_group_table[CLAY_THORVG_MAX_GROUPS];

/** The last frame as clay_dump.h's tables: the command array as it is, the element names and the text fields by node,
 *  and a copy of the renderer's effects (its own tables are not the emitter's types). */
static ClayDumpFrame dump_frame(void)
{
    for (int i = 0; i < tvg.treeCount; i++) dump_node_ids[i] = tvg.tree[i].id;
    for (int i = 0; i < tvg.shadowCount; i++) {
        dump_shadow_table[i].id = tvg.shadows[i].id;
        dump_shadow_table[i].x = tvg.shadows[i].x, dump_shadow_table[i].y = tvg.shadows[i].y;
        dump_shadow_table[i].blur = tvg.shadows[i].blur;
        dump_shadow_table[i].color = tvg.shadows[i].color;
    }
    for (int i = 0; i < tvg.backdropCount; i++) {
        dump_backdrop_table[i].id = tvg.backdrops[i].id;
        dump_backdrop_table[i].blur = tvg.backdrops[i].blur;
    }
    for (int i = 0; i < tvg.gradientCount; i++) {
        ClayDumpGradient *g = &dump_gradient_table[i];
        g->id = tvg.gradients[i].id, g->kind = tvg.gradients[i].kind;
        g->angle = tvg.gradients[i].angle, g->alpha = tvg.gradients[i].alpha;
        g->count = tvg.gradients[i].count;
        for (int s = 0; s < g->count && s < CLAY_DUMP_MAX_STOPS; s++)
            g->offset[s] = tvg.gradients[i].offset[s], g->color[s] = tvg.gradients[i].color[s];
    }
    for (int i = 0; i < tvg.groupCount; i++) {
        dump_group_table[i].at = tvg.groups[i].at, dump_group_table[i].alpha = tvg.groups[i].alpha;
        dump_group_table[i].scale = tvg.groups[i].scale, dump_group_table[i].tx = tvg.groups[i].tx;
        dump_group_table[i].ty = tvg.groups[i].ty, dump_group_table[i].rotate = tvg.groups[i].rotate;
    }
    return (ClayDumpFrame){
        .commands = cmds,
        .width = width,
        .height = height,
        .scale = tvg.scale,
        .hash = frame_hash,
        .names = id_names,
        .nameCount = id_name_count,
        .nodeIds = dump_node_ids,
        .nodeCount = tvg.treeCount,
        .textAlign = text_align,
        .textWrap = text_wrap,
        .textWeight = tvg.textWeight,
        .shadows = dump_shadow_table,
        .shadowCount = tvg.shadowCount,
        .backdrops = dump_backdrop_table,
        .backdropCount = tvg.backdropCount,
        .gradients = dump_gradient_table,
        .gradientCount = tvg.gradientCount,
        .groups = dump_group_table,
        .groupCount = tvg.groupCount,
    };
}

/**
 * Writes the last frame as JSON at `path`, through desktop/clay_dump.c (the schema is there): every command's fields that
 * a draw reads, the renderer's side tables beside them, and the frame's hash. 0 on success, -1 when the file cannot be
 * written. This is solid/goldens' source; the raster stays the final gate.
 */
int ui_dump_json(const char *path)
{
    const ClayDumpFrame frame = dump_frame();
    const ClayDump dump = Clay_DumpFrame(&frame);
    if (!dump.bytes) return -1;
    FILE *f = fopen(path, "wb");
    if (!f) {
        Clay_DumpFree(dump);
        return -1;
    }
    const int wrote = fwrite(dump.bytes, 1, (size_t)dump.length, f) == (size_t)dump.length;
    Clay_DumpFree(dump);
    return fclose(f) == 0 && wrote ? 0 : -1;
}

/** Draws of the process (ui_draw calls); a test's counter for the frames a page at rest does not draw. */
int ui_draws(void) { return draw_count; }

/** Presents of the process (ui_window_present calls). */
int ui_presents(void) { return present_count; }

/** The text weight the renderer draws with, in Clay units: 0 is ThorVG's own raster, 0.5 draws every line twice, half a
 *  unit either side of its place. `solid/text-oracle.ts --sweep` measures the alternatives; the sheet's numbers keep this
 *  at 0 (ThorVG's text already weighs what the platform's does). */
void ui_text_weight(float px) { tvg.textWeight = px > 0 ? px : 0; }

/** Draws the commands of the last ui_end on black into the buffer. */
void ui_draw(void)
{
    draw_count++;
    const int n = (int)(width * tvg.scale) * (int)(height * tvg.scale);
    if (!gpu) for (int i = 0; i < n; i++) pixels[i] = 0xff000000; // the WebGPU texture carries the ground
    Clay_ThorVG_RenderClayCommands(&tvg, &cmds);
#ifdef CLAY_THORVG_WG
    if (gpu) Clay_Wg_Readback(&wg, pixels);
#endif
}

/** The pixel at x, y (in Clay units) of the last frame: R, G, B, A bytes, R lowest. */
unsigned ui_pixel(int x, int y)
{
    return pixels[(int)(y * tvg.scale) * (int)(width * tvg.scale) + (int)(x * tvg.scale)];
}

/** Copies the last frame's pixels (RGBA32, top row first, at the renderer's scale) into out: the byte count, or -1 when
 *  cap is short. The headless tests read a crop of it, and the text metric a whole frame. */
int ui_pixels_copy(void *out, int cap)
{
    const int n = (int)(width * tvg.scale) * (int)(height * tvg.scale) * 4;
    if (cap < n) return -1;
    memcpy(out, pixels, n);
    return n;
}

/** A PNG loaded for a comparison (the text oracle): its size and its RGBA32 bytes. */
static SDL_Surface *loaded_png;

/** Loads a PNG as RGBA32, replacing the last one: 0 on success, -1 when it is missing or unreadable. */
int ui_load_png(const char *path)
{
    SDL_Surface *raw = IMG_Load(path), *rgba = raw ? SDL_ConvertSurface(raw, SDL_PIXELFORMAT_RGBA32) : NULL;
    SDL_DestroySurface(raw);
    if (!rgba) return -1;
    SDL_DestroySurface(loaded_png);
    loaded_png = rgba;
    return 0;
}

/** The size of the loaded PNG, into out as [width, height]; 0 when nothing is loaded. */
int ui_png_size(int *out)
{
    if (!loaded_png) return 0;
    out[0] = loaded_png->w, out[1] = loaded_png->h;
    return 1;
}

/** Copies the loaded PNG into out: the byte count, or -1 when nothing is loaded or cap is short. */
int ui_png_copy(void *out, int cap)
{
    if (!loaded_png) return -1;
    const int n = loaded_png->w * loaded_png->h * 4;
    if (cap < n) return -1;
    for (int y = 0; y < loaded_png->h; y++)
        memcpy((Uint8 *)out + y * loaded_png->w * 4, (const Uint8 *)loaded_png->pixels + y * loaded_png->pitch,
               loaded_png->w * 4);
    return n;
}

static SDL_Surface *frame_surface(void)
{
    const int tw = (int)(width * tvg.scale), th = (int)(height * tvg.scale);
    return SDL_CreateSurfaceFrom(tw, th, SDL_PIXELFORMAT_RGBA32, pixels, tw * 4);
}

int ui_save_png(const char *path)
{
    SDL_Surface *s = frame_surface();
    const int ok = IMG_SavePNG(s, path);
    SDL_DestroySurface(s);
    return !ok;
}

/** Pixels of the last frame that differ from the PNG; -1 when it is missing or of another size. On a difference
 *  the frame is written to `actual`. */
int ui_diff_png(const char *ref_path, const char *actual)
{
    SDL_Surface *got = frame_surface(), *ref0 = IMG_Load(ref_path);
    SDL_Surface *ref = ref0 ? SDL_ConvertSurface(ref0, SDL_PIXELFORMAT_RGBA32) : NULL;
    int n = -1;
    if (ref && ref->w == got->w && ref->h == got->h) {
        n = 0;
        for (int y = 0; y < got->h; y++) {
            const Uint32 *a = (const Uint32 *)((const Uint8 *)got->pixels + y * got->pitch);
            const Uint32 *b = (const Uint32 *)((const Uint8 *)ref->pixels + y * ref->pitch);
            for (int x = 0; x < got->w; x++) n += a[x] != b[x];
        }
    }
    if (n && actual) IMG_SavePNG(got, actual);
    SDL_DestroySurface(got);
    SDL_DestroySurface(ref0);
    SDL_DestroySurface(ref);
    return n;
}

/** Opens the window (on Metal) and returns its pixel density; the canvas is rebuilt at that scale. 0 on failure. */
float ui_window_open(const char *title)
{
    if (!SDL_Init(SDL_INIT_VIDEO)) return 0;
    window = SDL_CreateWindow(title, width, height, SDL_WINDOW_HIGH_PIXEL_DENSITY);
    renderer = window ? SDL_CreateRenderer(window, NULL) : NULL;
    if (!renderer) return 0;
    SDL_SetRenderLogicalPresentation(renderer, width, height, SDL_LOGICAL_PRESENTATION_LETTERBOX);
    const float scale = SDL_GetWindowPixelDensity(window);
    if (retarget(scale)) return 0;
    texture = SDL_CreateTexture(renderer, SDL_PIXELFORMAT_RGBA32, SDL_TEXTUREACCESS_STREAMING,
                                (int)(width * scale), (int)(height * scale));
    // ThorVG's WebGPU canvas renders premultiplied; the software canvas does not
    if (texture && gpu) SDL_SetTextureBlendMode(texture, SDL_BLENDMODE_BLEND_PREMULTIPLIED);
    return texture ? scale : 0;
}

// key events of the polls, in order: [down (1) or up (0), SDL keycode, SDL_Keymod, repeat]
#define KEY_QUEUE 64
static int keys[KEY_QUEUE][4];
static int keys_head, keys_len;

// typed text of the polls, in order: the UTF-8 bytes of one SDL_EVENT_TEXT_INPUT (a composed character, not a keycode)
#define TEXT_QUEUE 64
// ponytail: 128 bytes an event is more than one IME commit could be; a longer one is cut at a character boundary
#define TEXT_MAX 128
static char texts[TEXT_QUEUE][TEXT_MAX];
static int text_lens[TEXT_QUEUE];
static int texts_head, texts_len;

/** Pops the oldest key event into out[4] (down or up, SDL keycode, SDL_Keymod, repeat); 0 when there is none. */
int ui_key_pop(int *out)
{
    if (!keys_len) return 0;
    memcpy(out, keys[keys_head], sizeof keys[0]);
    keys_head = (keys_head + 1) % KEY_QUEUE, keys_len--;
    return 1;
}

/** Copies up to cap bytes of UTF-8 without cutting a character in two: the bytes of a lead byte and its helpers. */
static int copy_utf8(char *to, const char *from, int len, int cap)
{
    if (len > cap) {
        len = cap;
        while (len > 0 && ((unsigned char)from[len] & 0xC0) == 0x80) len--;
    }
    memcpy(to, from, len);
    return len;
}

/** Pops the oldest typed run into out[cap] as UTF-8 and returns its byte length; 0 when there is none. */
int ui_text_pop(char *out, int cap)
{
    if (!texts_len || cap <= 0) return 0;
    const int n = copy_utf8(out, texts[texts_head], text_lens[texts_head], cap);
    texts_head = (texts_head + 1) % TEXT_QUEUE, texts_len--;
    return n;
}

/** Turns SDL's text input on (1) or off (0) for the window: SDL_EVENT_TEXT_INPUT only arrives while it runs. */
void ui_text_input(int on)
{
    if (!window) return;
    if (on) SDL_StartTextInput(window);
    else SDL_StopTextInput(window);
}

/** The clipboard as UTF-8 into out[cap], NUL-terminated; returns the bytes written (0 when empty or too long). */
int ui_clipboard_get(char *out, int cap)
{
    char *text = SDL_GetClipboardText();
    if (!text || cap <= 0) {
        SDL_free(text);
        return 0;
    }
    const int len = copy_utf8(out, text, (int)strlen(text), cap - 1);
    out[len] = 0;
    SDL_free(text);
    return len;
}

/** Replaces the clipboard with len bytes of UTF-8. */
void ui_clipboard_set(const char *text, int len)
{
    char *copy = strndup(text, len);
    if (copy) SDL_SetClipboardText(copy), free(copy);
}

/** Writes the box of the element with that id, in the layout of the last frame, into out[4] (x, y, w, h); 0 when
 *  there is no such element. */
int ui_bounds(const char *id, int len, float *out)
{
    const Clay_ElementData d = Clay_GetElementData(Clay__HashString(slice(id, len), 0));
    if (!d.found) return 0;
    out[0] = d.boundingBox.x, out[1] = d.boundingBox.y, out[2] = d.boundingBox.width, out[3] = d.boundingBox.height;
    return 1;
}

/** The scroll offset of the clip element with that id along `axis` (0 y, 1 x), in pixels (negative is scrolled down or
 *  right); 0 when there is none. */
float ui_scroll_offset(const char *id, int len, int axis)
{
    const Clay_ScrollContainerData d = Clay_GetScrollContainerData(Clay__HashString(slice(id, len), 0));
    if (!d.found) return 0;
    return axis ? d.scrollPosition->x : d.scrollPosition->y;
}

/** Scrolls the clip element with that id to `v` on `axis` (0 y, 1 x; negative is down or right), clamped to its content;
 *  returns the offset it took. */
float ui_scroll_to(const char *id, int len, int axis, float v)
{
    const Clay_ScrollContainerData d = Clay_GetScrollContainerData(Clay__HashString(slice(id, len), 0));
    if (!d.found) return 0;
    // the range Clay itself clamps to: from the start to the last screenful of the content
    if (axis) {
        const float lowest = -fmaxf(d.contentDimensions.width - d.scrollContainerDimensions.width, 0);
        d.scrollPosition->x = fminf(fmaxf(v, lowest), 0);
        return d.scrollPosition->x;
    }
    const float lowest = -fmaxf(d.contentDimensions.height - d.scrollContainerDimensions.height, 0);
    d.scrollPosition->y = fminf(fmaxf(v, lowest), 0);
    return d.scrollPosition->y;
}

/** Puts a clip element's offset on `axis` where the page says, with the content's clamp left out: a rubber band past an
 *  end is past the content on purpose, and only the page knows how far. 0 when the element is no clip element. */
float ui_scroll_put(const char *id, int len, int axis, float v)
{
    const Clay_ScrollContainerData d = Clay_GetScrollContainerData(Clay__HashString(slice(id, len), 0));
    if (!d.found) return 0;
    if (axis) d.scrollPosition->x = v;
    else d.scrollPosition->y = v;
    return v;
}

/** A finger's position, normalised to the window (SDL's tfinger.x/y: 0..1, (0,0) the top left), in the logical pixels
 *  of the pointer (ui_window_poll, out[0..1]). The window is presented at the layout's size with letterboxing, so the
 *  layout's width and height are the window's. The one place the mapping happens: the poll calls it for every finger
 *  event, and so does the headless `--touch` option (solid/main.ts), so the mapping is covered without a touchscreen.
 *  SDL's coordinates are normalised but not clamped (a touch in the letterbox is outside 0..1): no clamp here either,
 *  the pointer simply lands outside every box. */
void ui_touch_map(float fx, float fy, float *out)
{
    out[0] = fx * width;
    out[1] = fy * height;
}

// The finger that owns the pointer: a mouse and a finger are one pointer (the pages have one), so the first finger down
// is the pointer's, and a second finger is ignored until the first lifts (no pinch, no two-finger gesture: nothing in a
// page reads one).
static Uint64 finger_owner;
static int finger_held;

/** Drains the window's events into out[6]: pointer x, y, button down, quit, the last key pressed (its character; 0 for
 *  none), and whether the last pointer event was a finger (1) or the mouse (0). The pointer and the button keep their
 *  last values between polls. Every key down and up (a repeat too) is also queued for ui_key_pop (the oldest are
 *  dropped past 64), every typed run for ui_text_pop, and every wheel event adds to the next frame's scroll (ui_wheel).
 *  SDL's finger events (FINGER_DOWN/MOTION/UP) go through ui_touch_map into the same pointer state as the mouse's:
 *  down while the finger is on the window, up at the place it left, and a FINGER_CANCELED is a lift too. */
void ui_window_poll(float *out)
{
    SDL_Event e;
    out[3] = 0, out[4] = 0;
    while (SDL_PollEvent(&e)) {
        if (e.type == SDL_EVENT_QUIT) out[3] = 1;
        // SDL's wheel y is positive away from the user, and so is Clay's scroll delta: no sign to flip. ui_wheel feeds
        // Clay's containers and the page's own channel at once. A shift+wheel is a horizontal scroll, as a browser's is:
        // the window's mod state swaps a vertical delta onto x when the wheel has none of its own (a trackpad sends x).
        if (e.type == SDL_EVENT_MOUSE_WHEEL) {
            float dx = e.wheel.x, dy = e.wheel.y;
            if (dx == 0 && (SDL_GetModState() & SDL_KMOD_SHIFT)) dx = dy, dy = 0;
            ui_wheel(dx, dy);
        }
        if (e.type == SDL_EVENT_KEY_DOWN || e.type == SDL_EVENT_KEY_UP) {
            if (keys_len == KEY_QUEUE) keys_head = (keys_head + 1) % KEY_QUEUE, keys_len--;
            int *k = keys[(keys_head + keys_len++) % KEY_QUEUE];
            k[0] = e.type == SDL_EVENT_KEY_DOWN, k[1] = (int)e.key.key, k[2] = (int)e.key.mod, k[3] = e.key.repeat;
        }
        if (e.type == SDL_EVENT_KEY_DOWN) out[4] = (float)e.key.key;
        if (e.type == SDL_EVENT_TEXT_INPUT) {
            const int at = (texts_head + texts_len) % TEXT_QUEUE;
            const int len = copy_utf8(texts[at], e.text.text, (int)strlen(e.text.text), TEXT_MAX);
            if (len > 0) {
                if (texts_len == TEXT_QUEUE) texts_head = (texts_head + 1) % TEXT_QUEUE, texts_len--;
                text_lens[at] = len, texts_len++;
            }
        }
        if (e.type == SDL_EVENT_FINGER_DOWN || e.type == SDL_EVENT_FINGER_MOTION || e.type == SDL_EVENT_FINGER_UP ||
            e.type == SDL_EVENT_FINGER_CANCELED) {
            if (e.type == SDL_EVENT_FINGER_DOWN && !finger_held) finger_owner = e.tfinger.fingerID, finger_held = 1;
            if (finger_held && e.tfinger.fingerID == finger_owner) {
                ui_touch_map(e.tfinger.x, e.tfinger.y, out);
                if (e.type == SDL_EVENT_FINGER_DOWN) out[2] = 1;
                if (e.type == SDL_EVENT_FINGER_UP || e.type == SDL_EVENT_FINGER_CANCELED) out[2] = 0, finger_held = 0;
                out[5] = 1;
            }
        }
        if (e.type == SDL_EVENT_MOUSE_MOTION || e.type == SDL_EVENT_MOUSE_BUTTON_DOWN ||
            e.type == SDL_EVENT_MOUSE_BUTTON_UP) {
            SDL_ConvertEventToRenderCoordinates(renderer, &e);
            out[0] = e.type == SDL_EVENT_MOUSE_MOTION ? e.motion.x : e.button.x;
            out[1] = e.type == SDL_EVENT_MOUSE_MOTION ? e.motion.y : e.button.y;
            if (e.type == SDL_EVENT_MOUSE_BUTTON_DOWN) out[2] = 1;
            if (e.type == SDL_EVENT_MOUSE_BUTTON_UP) out[2] = 0;
            out[5] = 0;
        }
    }
}

void ui_window_present(void)
{
    present_count++;
    SDL_UpdateTexture(texture, NULL, pixels, (int)(width * tvg.scale) * 4);
    SDL_SetRenderDrawColor(renderer, 0, 0, 0, 255);
    SDL_RenderClear(renderer);
    SDL_RenderTexture(renderer, texture, NULL, NULL);
    SDL_RenderPresent(renderer);
}
