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
#ifdef CLAY_THORVG_WG
#include "../../desktop/thorvg_wg.c" // --raster thorvg-gpu: the WebGPU canvas and its readback
#else
typedef struct { int unused; } Clay_WgTarget; // only the GPU build (desktop/build-thorvg-gpu.sh solid)
#endif

#define MAX_FONTS 8
#define ARENA_SIZE (1 << 16)

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
#define MAX_IMAGES 64
static const char *image_paths[MAX_IMAGES];
static int image_count;
static const char *pending_image;

static SDL_Window *window;
static SDL_Renderer *renderer;
static SDL_Texture *texture;
static Clay_WgTarget wg; // the WebGPU device and texture, when the canvas is ThorVG's WebGPU one
static int gpu;          // 0: the software canvas; 1: the WebGPU canvas, the frame read back into pixels

// the wheel the polls took, in Clay's units (positive scrolls the content down, the wheel up), for the next ui_begin
static float wheel_x, wheel_y;

/** Adds a wheel delta to the next frame, in Clay's units: positive scrolls the content down, as SDL's wheel y. */
void ui_wheel(float dx, float dy) { wheel_x += dx, wheel_y += dy; }

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
    return tvg_swcanvas_set_target(tvg.canvas, pixels, tw, tw, th, TVG_COLORSPACE_ABGR8888);
}

/** Starts Clay and a ThorVG canvas of w x h; 0 on success. `want_gpu` picks the WebGPU canvas over the software one. */
static int init(int w, int h, int want_gpu)
{
    width = w, height = h;
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
    Clay_SetPointerState((Clay_Vector2){px, py}, down);
    // Clay's scroll containers: the wheel delta of the polls moves the container the pointer is over, before the layout
    // reads the offsets (ui_open hands each clip element its own through Clay_GetScrollOffset). No drag scrolling: a
    // press belongs to the page's parts.
    Clay_UpdateScrollContainers(0, (Clay_Vector2){wheel_x, wheel_y}, dt);
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
    for (int i = 0; i < image_count; i++)
        if ((int)strlen(image_paths[i]) == len && memcmp(image_paths[i], path, (size_t)len) == 0) {
            pending_image = image_paths[i];
            return;
        }
    // ponytail: 64 distinct paths a process, never freed; a page with more needs a bigger table
    if (image_count == MAX_IMAGES) {
        errors++;
        return;
    }
    image_paths[image_count] = strndup(path, (size_t)len);
    pending_image = image_paths[image_count++];
}

/** Opens an element. id is NULL for an anonymous one; f is 45 floats: the box fields, then the floating ones. */
void ui_open(const char *id, int len, const float *f)
{
    static const Clay_LayoutAlignmentX ax[3] = {CLAY_ALIGN_X_LEFT, CLAY_ALIGN_X_CENTER, CLAY_ALIGN_X_RIGHT};
    static const Clay_LayoutAlignmentY ay[3] = {CLAY_ALIGN_Y_TOP, CLAY_ALIGN_Y_CENTER, CLAY_ALIGN_Y_BOTTOM};
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
    if (id) Clay__OpenElementWithId(Clay__HashString(slice(id, len), 0));
    else Clay__OpenElement();
    // a clip element is a scroll container: the offset Clay kept for it across frames is what shifts its children (its
    // debug view feeds its own the same way). Before Clay__ConfigureOpenElement, which reads this declaration.
    if (d.clip.horizontal || d.clip.vertical) d.clip.childOffset = Clay_GetScrollOffset();
    Clay__ConfigureOpenElement(d);
}

void ui_close(void) { Clay__CloseElement(); }

/** A text element: the bytes are copied for the frame; f is 10 floats. */
void ui_text(const char *s, int len, const float *f)
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
    Clay_TextElementConfig c = {0};
    c.textColor = color(f);
    c.fontId = f[4], c.fontSize = f[5], c.letterSpacing = f[6], c.lineHeight = f[7];
    c.textAlignment = al[(int)f[8]], c.wrapMode = wm[(int)f[9]];
    Clay__OpenTextElement(slice(copy, len), c);
}

/** Closes the layout: Clay computes the boxes. Returns the command count. */
int ui_end(float dt)
{
    cmds = Clay_EndLayout(dt);
    return cmds.length;
}

/** Draws the commands of the last ui_end on black into the buffer. */
void ui_draw(void)
{
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

/** The scroll offset of the clip element with that id, in pixels (negative is scrolled down); 0 when there is none. */
float ui_scroll_offset(const char *id, int len)
{
    const Clay_ScrollContainerData d = Clay_GetScrollContainerData(Clay__HashString(slice(id, len), 0));
    return d.found ? d.scrollPosition->y : 0;
}

/** Scrolls the clip element with that id to y (negative is down), clamped to its content; returns the offset it took. */
float ui_scroll_to(const char *id, int len, float y)
{
    const Clay_ScrollContainerData d = Clay_GetScrollContainerData(Clay__HashString(slice(id, len), 0));
    if (!d.found) return 0;
    // the range Clay itself clamps to: from the top to the last screenful of the content
    const float lowest = -fmaxf(d.contentDimensions.height - d.scrollContainerDimensions.height, 0);
    d.scrollPosition->y = fminf(fmaxf(y, lowest), 0);
    return d.scrollPosition->y;
}

/** Drains the window's events into out[5]: pointer x, y, button down, quit, and the last key pressed (its
 *  character; 0 for none). The pointer and the button keep their last values between polls. Every key down and up
 *  (a repeat too) is also queued for ui_key_pop (the oldest are dropped past 64), every typed run for ui_text_pop,
 *  and every wheel event adds to the next frame's scroll (ui_wheel). */
void ui_window_poll(float *out)
{
    SDL_Event e;
    out[3] = 0, out[4] = 0;
    while (SDL_PollEvent(&e)) {
        if (e.type == SDL_EVENT_QUIT) out[3] = 1;
        // SDL's wheel y is positive away from the user, and so is Clay's scroll delta: no sign to flip
        if (e.type == SDL_EVENT_MOUSE_WHEEL) wheel_x += e.wheel.x, wheel_y += e.wheel.y;
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
        if (e.type == SDL_EVENT_MOUSE_MOTION || e.type == SDL_EVENT_MOUSE_BUTTON_DOWN ||
            e.type == SDL_EVENT_MOUSE_BUTTON_UP) {
            SDL_ConvertEventToRenderCoordinates(renderer, &e);
            out[0] = e.type == SDL_EVENT_MOUSE_MOTION ? e.motion.x : e.button.x;
            out[1] = e.type == SDL_EVENT_MOUSE_MOTION ? e.motion.y : e.button.y;
            if (e.type == SDL_EVENT_MOUSE_BUTTON_DOWN) out[2] = 1;
            if (e.type == SDL_EVENT_MOUSE_BUTTON_UP) out[2] = 0;
        }
    }
}

void ui_window_present(void)
{
    SDL_UpdateTexture(texture, NULL, pixels, (int)(width * tvg.scale) * 4);
    SDL_SetRenderDrawColor(renderer, 0, 0, 0, 255);
    SDL_RenderClear(renderer);
    SDL_RenderTexture(renderer, texture, NULL, NULL);
    SDL_RenderPresent(renderer);
}
