// The desktop host: an SDL3 window, Clay's layout, Clay's SDL3 renderer (Metal on a Mac) or ThorVG's software
// raster. The page is linked in: it defines app_frame(), which declares the Clay tree of one frame.
//
//   host                    a window; the mouse is the pointer
//   host --png out.png      one frame headless (the software renderer on a surface), written to out.png
//   host --expect ref.png   the same frame compared with ref.png pixel for pixel; exit 1 and write
//                           ref.png.actual.png on a difference
//   host --dump out.json    the same frame as JSON (desktop/clay_dump.c, the one emitter on every target): the commands
//                           with their fields and the host's effect tables (this host has none: an empty table each).
//                           It is the C page's command stream for a golden; the layout is the raster's own, so dump a
//                           ThorVG frame to compare with a Solid golden
//   --click X Y             headless: a press and a release at X,Y before the frame that is written
//   --press X Y             headless: a press at X,Y held down, the frame written while still pressed
//   --scene file.json       headless: replay a scene (desktop/scene.c: the JSON of solid/scenes/*.json, pointer/settle/
//                           frame steps) and write or compare its last frame
//   --raster thorvg|thorvg-gpu|sdl
//                           clay_renderer_thorvg.c into a buffer that is the frame headless and a texture in the
//                           window (the default), the same scene on ThorVG's WebGPU canvas read back into that
//                           buffer (only a build with CLAY_THORVG_WG, desktop/build-thorvg-gpu.sh), or Clay's
//                           SDL3 renderer
//   --bench N               headless: draw the last frame N more times and print the raster's ms a frame
//
// Built with PAGE_STATES (`desktop/build.sh examples/sensors --generated`), the page is a generated state machine: the
// host keeps the current state, asks `<prefix>_next` on each press and release over an element with a handler, and
// draws `<prefix>_frame(state, light)`. Without it the page keeps its own signals, as page.c does.
#define CLAY_IMPLEMENTATION
#include "clay.h"

#include <SDL3/SDL.h>
#include <SDL3_image/SDL_image.h>
#include <SDL3_ttf/SDL_ttf.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "clay_dump.c"
#include "clay_renderer_SDL3.c"
#include "clay_renderer_thorvg.c"

#ifdef CLAY_THORVG_WG
#include "thorvg_wg.c"
#else
typedef struct { int unused; } Clay_WgTarget; // --raster thorvg-gpu: only the WebGPU build (build-thorvg-gpu.sh)
#endif

#ifndef APP_W
#define APP_W 360
#define APP_H 360
#endif

void app_frame(bool down);
#ifdef PAGE_STATES
// page_generated_events.c: the page as a state machine (generator/page-to-c.ts), named by its --events-name
#include "events.h"
#include "scene.h"
#include "scene.c"
#define PAGE_NAME2(a, b) a##b
#define PAGE_NAME(a, b) PAGE_NAME2(a, b)
#define PAGE_STATE(name) PAGE_NAME(PAGE_STATE_PREFIX, name)
int PAGE_STATE(_state_count)(void);
int PAGE_STATE(_next)(int state, uint32_t id, int event);
int PAGE_STATE(_handler_count)(void);
uint32_t PAGE_STATE(_handler_id)(int index);
const char *PAGE_STATE(_state_name)(int state);
void PAGE_STATE(_frame)(int state, int light);
#ifndef PAGE_NAME_STRING
#define PAGE_STRINGIFY2(x) #x
#define PAGE_STRINGIFY(x) PAGE_STRINGIFY2(x)
#define PAGE_NAME_STRING PAGE_STRINGIFY(PAGE_STATE_PREFIX)
#endif
static int page_state, page_rest, page_light, page_was_down;
static uint32_t page_pressed;
#else
void app_key(int key); // a key press in the window: the SDL keycode (a letter is its ASCII code)
#endif

static Clay_Dimensions measure(Clay_StringSlice text, Clay_TextElementConfig *config, void *user)
{
    TTF_Font *font = ((TTF_Font **)user)[config->fontId];
    int w = 0, h = 0;
    TTF_SetFontSize(font, config->fontSize ? config->fontSize : 14);
    TTF_GetStringSize(font, text.chars, text.length, &w, &h);
    return (Clay_Dimensions){(float)w, config->lineHeight ? (float)config->lineHeight : (float)h};
}

static int errors;
static void on_error(Clay_ErrorData e)
{
    errors++;
    fprintf(stderr, "clay error %d: %.*s\n", (int)e.errorType, (int)e.errorText.length, e.errorText.chars);
}

static SDL_Surface *frame_pixels(SDL_Renderer *r)
{
    SDL_Surface *s = SDL_RenderReadPixels(r, NULL);
    SDL_Surface *rgba = s ? SDL_ConvertSurface(s, SDL_PIXELFORMAT_RGBA32) : NULL;
    SDL_DestroySurface(s);
    return rgba;
}

/** Pixels that differ between two RGBA32 surfaces of one size; -1 when the sizes differ. */
static long differ(SDL_Surface *a, SDL_Surface *b)
{
    if (a->w != b->w || a->h != b->h) return -1;
    long n = 0;
    for (int y = 0; y < a->h; y++) {
        const Uint32 *pa = (const Uint32 *)((const Uint8 *)a->pixels + y * a->pitch);
        const Uint32 *pb = (const Uint32 *)((const Uint8 *)b->pixels + y * b->pitch);
        for (int x = 0; x < a->w; x++) n += pa[x] != pb[x];
    }
    return n;
}

/** One frame on a black ground, by the chosen raster. */
static void draw(bool thorvg, Clay_WgTarget *wg, Clay_ThorVGRendererData *tvg, Uint32 *pixels, int n,
                 Clay_SDL3RendererData *sdl, Clay_RenderCommandArray *cmds)
{
    if (thorvg) {
        if (!wg) for (int i = 0; i < n; i++) pixels[i] = 0xff000000; // the WebGPU texture is its own cleared target
        Clay_ThorVG_RenderClayCommands(tvg, cmds);
#ifdef CLAY_THORVG_WG
        if (wg) Clay_Wg_Readback(wg, pixels);
#endif
        return;
    }
    SDL_SetRenderDrawColor(sdl->renderer, 0, 0, 0, 255);
    SDL_RenderClear(sdl->renderer);
    SDL_Clay_RenderClayCommands(sdl, cmds);
}

/** The frame as JSON at `path`, through desktop/clay_dump.c (the schema is there). The C page has no shadows, backdrops,
 *  gradients or groups, so those tables are empty; it keeps no id strings either, so a command's `element` is null and a
 *  differ resolves it by id from the golden of the same page. 0 on success. */
static int write_dump(const char *path, Clay_RenderCommandArray cmds, Clay_ThorVGRendererData *tvg)
{
    const ClayDumpFrame frame = {.commands = cmds,
                                 .width = APP_W,
                                 .height = APP_H,
                                 .scale = tvg->scale,
                                 .hash = 0, // the frame's hash is the Solid host's (ui_hash)
                                 .textWeight = tvg->textWeight};
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

/** The last frame: written, dumped and/or compared. Returns the process's status. */
static int finish(SDL_Surface *got, const char *png, const char *expect, const char *dump, Clay_RenderCommandArray cmds,
                  Clay_ThorVGRendererData *tvg)
{
    int status = errors ? 1 : 0;
    if (png) IMG_SavePNG(got, png);
    if (dump && write_dump(dump, cmds, tvg)) {
        fprintf(stderr, "%s: cannot write the frame\n", dump);
        status = 1;
    }
    if (expect) {
        SDL_Surface *ref0 = IMG_Load(expect);
        SDL_Surface *ref = ref0 ? SDL_ConvertSurface(ref0, SDL_PIXELFORMAT_RGBA32) : NULL;
        const long n = ref ? differ(got, ref) : -1;
        if (n) {
            char out[1024];
            snprintf(out, sizeof out, "%s.actual.png", expect);
            IMG_SavePNG(got, out);
            fprintf(stderr, "%s: %ld pixels differ (-1: missing or another size); this frame is %s\n", expect, n, out);
            status = 1;
        } else {
            printf("%s: identical, %d commands\n", expect, cmds.length);
        }
    }
    return status;
}

#ifdef PAGE_STATES
/** The element with a handler under the pointer: Clay's pointerOverIds are the last layout's, as page.c's own
 *  Clay_PointerOver is. 0 for none. */
static uint32_t page_hit(void)
{
    for (int i = 0; i < PAGE_STATE(_handler_count)(); i++) {
        const uint32_t id = PAGE_STATE(_handler_id)(i);
        if (id && Clay_PointerOver((Clay_ElementId){.id = id})) return id;
    }
    return 0;
}

/**
 * The two edges of a click: a press over an element with a handler asks the table for the state its :active draws, a
 * release over the element the press was on asks for the state its onClick leads to (with :hover), and a release
 * anywhere else puts the state back where the press found it. Clay is asked about the *last* frame's boxes, as page.c's
 * Clay_OnHover is.
 */
static void page_dispatch(int down)
{
    if (down && !page_was_down) {
        page_rest = page_state;
        const uint32_t id = page_hit();
        if (id) {
            page_pressed = id;
            page_state = PAGE_STATE(_next)(page_state, id, CLAY_EVENT_PRESS);
        }
    } else if (!down && page_was_down && page_pressed) {
        const uint32_t id = page_pressed;
        page_pressed = 0;
        page_state = Clay_PointerOver((Clay_ElementId){.id = id})
                         ? PAGE_STATE(_next)(page_state, id, CLAY_EVENT_RELEASE)
                         : page_rest;
    }
    page_was_down = down;
}

/** What the scene replay draws through: the host's renderer locals, one struct. */
typedef struct {
    bool thorvg;
    Clay_WgTarget *wg;
    Clay_ThorVGRendererData *tvg;
    Uint32 *pixels;
    int n;
    Clay_SDL3RendererData *sdl;
    SDL_Renderer *renderer;
    int tw, th;
} Target;

/** A scene replayed on the generated page: every frame laid out and drawn, the last one written, dumped or compared. */
static int run_scene(const Scene *scene, Target t, const char *png, const char *expect, const char *dump)
{
    if (strcmp(scene->page, PAGE_NAME_STRING)) {
        fprintf(stderr, "scene %s: page \"%s\" is not this build's \"%s\"\n", scene->name, scene->page,
                PAGE_NAME_STRING);
        return 2;
    }
    if (scene->width != APP_W || scene->height != APP_H) {
        fprintf(stderr, "scene %s: size %dx%d is not this page's %dx%d\n", scene->name, scene->width, scene->height,
                APP_W, APP_H);
        return 2;
    }
    page_light = scene->light;
    page_state = 0, page_rest = 0, page_pressed = 0, page_was_down = 0;
    float px = -1, py = -1;
    int down = 0;
    int frames = 1;
    for (int i = 0; i < scene->count; i++) {
        const SceneStep *step = &scene->steps[i];
        const int last = step->kind == SCENE_SETTLE ? step->frame + step->frames : step->frame + 1;
        if (last > frames) frames = last;
    }
    int at = 0;
    Clay_RenderCommandArray cmds = {0, 0};
    for (int f = 0; f < frames; f++) {
        while (at < scene->count && scene->steps[at].frame <= f) {
            const SceneStep *step = &scene->steps[at++];
            if (step->kind == SCENE_POINTER) px = step->x, py = step->y, down = step->down;
        }
        Clay_SetPointerState((Clay_Vector2){px, py}, down);
        page_dispatch(down);
        Clay_SetLayoutDimensions((Clay_Dimensions){APP_W, APP_H});
        Clay_BeginLayout();
        PAGE_STATE(_frame)(page_state, page_light);
        cmds = Clay_EndLayout(1.0f / 60.0f);
        draw(t.thorvg, t.wg, t.tvg, t.pixels, t.n, t.sdl, &cmds);
    }
    printf("scene %s: page %s, %d steps, %d frames, ending state %d \"%s\"\n", scene->name, scene->page, scene->count,
           frames, page_state, PAGE_STATE(_state_name)(page_state));
    SDL_Surface *got = t.thorvg ? SDL_CreateSurfaceFrom(t.tw, t.th, SDL_PIXELFORMAT_RGBA32, t.pixels, t.tw * 4)
                                : frame_pixels(t.renderer);
    return finish(got, png, expect, dump, cmds, t.tvg);
}
#endif

int main(int argc, char **argv)
{
    const char *png = NULL, *expect = NULL, *dump = NULL, *raster = "thorvg", *scene = NULL;
    int bench = 0;
    float click_x = -1, click_y = -1;
    bool hold = false;
    for (int i = 1; i + 1 < argc; i++) {
        if ((!strcmp(argv[i], "--click") || !strcmp(argv[i], "--press")) && i + 2 < argc) {
            hold = !strcmp(argv[i], "--press");
            click_x = strtof(argv[++i], NULL), click_y = strtof(argv[++i], NULL);
            continue;
        }
        if (!strcmp(argv[i], "--png")) png = argv[++i];
        else if (!strcmp(argv[i], "--expect")) expect = argv[++i];
        else if (!strcmp(argv[i], "--dump")) dump = argv[++i];
        else if (!strcmp(argv[i], "--raster")) raster = argv[++i];
        else if (!strcmp(argv[i], "--bench")) bench = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--scene")) scene = argv[++i];
    }
    const bool gpu = !strcmp(raster, "thorvg-gpu");
    const bool thorvg = gpu || !strcmp(raster, "thorvg");
    if (!thorvg && strcmp(raster, "sdl")) {
        fprintf(stderr, "--raster %s: sdl, thorvg or thorvg-gpu\n", raster);
        return 2;
    }
    const bool headless = png || expect || dump || scene;
    if (!SDL_Init(SDL_INIT_VIDEO) || !TTF_Init()) {
        fprintf(stderr, "init: %s\n", SDL_GetError());
        return 1;
    }
    // headless frames are the reference: the software renderer on a surface, no window and no GPU
    SDL_Surface *canvas = headless ? SDL_CreateSurface(APP_W, APP_H, SDL_PIXELFORMAT_RGBA32) : NULL;
    SDL_Window *window = headless ? NULL : SDL_CreateWindow("cssints-native", APP_W, APP_H, SDL_WINDOW_HIGH_PIXEL_DENSITY);
    SDL_Renderer *renderer = headless ? SDL_CreateSoftwareRenderer(canvas) : SDL_CreateRenderer(window, NULL);
    if (!renderer) {
        fprintf(stderr, "window: %s\n", SDL_GetError());
        return 1;
    }
    if (window) SDL_SetRenderLogicalPresentation(renderer, APP_W, APP_H, SDL_LOGICAL_PRESENTATION_LETTERBOX);
    SDL_SetRenderDrawBlendMode(renderer, SDL_BLENDMODE_BLEND);

    TTF_Font *fonts[1] = {TTF_OpenFont(FONT_PATH, 14)};
    if (!fonts[0]) {
        fprintf(stderr, "font %s: %s\n", FONT_PATH, SDL_GetError());
        return 1;
    }
    Clay_SDL3RendererData data = {.renderer = renderer, .textEngine = TTF_CreateRendererTextEngine(renderer),
                                  .fonts = fonts};

    uint32_t size = Clay_MinMemorySize();
    Clay_Initialize(Clay_CreateArenaWithCapacityAndMemory(size, malloc(size)), (Clay_Dimensions){APP_W, APP_H},
                    (Clay_ErrorHandler){on_error});
    Clay_SetMeasureTextFunction(measure, fonts);

    // ThorVG: a canvas on a buffer of the window's pixels (APP_W x APP_H headless), measuring its own text
    const char *tvg_fonts[1] = {"Roboto-Regular"};
    Clay_ThorVGRendererData tvg = {.scale = window ? SDL_GetWindowPixelDensity(window) : 1, .fonts = tvg_fonts};
    const int tw = (int)(APP_W * tvg.scale), th = (int)(APP_H * tvg.scale);
    Uint32 *tvg_pixels = NULL;
    SDL_Texture *tvg_texture = NULL;
    Clay_WgTarget wg = {0}, *wg_target = NULL;
    if (thorvg) {
        tvg_pixels = malloc((size_t)tw * th * 4);
        if (tvg_engine_init(0) || tvg_font_load(FONT_PATH)) {
            fprintf(stderr, "thorvg: no engine or no font %s\n", FONT_PATH);
            return 1;
        }
        if (gpu) {
            bool ok = false;
#ifdef CLAY_THORVG_WG
            // the WebGPU canvas draws into a texture; the frame comes back as pixels for the same buffer
            ok = Clay_Wg_Create(&wg, tw, th) && (tvg.canvas = tvg_wgcanvas_create(TVG_ENGINE_OPTION_DEFAULT)) &&
                 !tvg_wgcanvas_set_target(tvg.canvas, wg.device, wg.instance, wg.texture, tw, th,
                                          TVG_COLORSPACE_ABGR8888, 1);
            if (ok) wg_target = &wg;
#endif
            if (!ok) {
                fprintf(stderr, "thorvg-gpu: no WebGPU canvas: needs a ThorVG built with -Dengines=wg and wgpu-native, "
                                "as desktop/build-thorvg-gpu.sh does\n");
                return 2;
            }
        } else if (!(tvg.canvas = tvg_swcanvas_create(TVG_ENGINE_OPTION_DEFAULT)) ||
                   tvg_swcanvas_set_target(tvg.canvas, tvg_pixels, tw, tw, th, TVG_COLORSPACE_ABGR8888)) {
            fprintf(stderr, "thorvg: no software canvas\n");
            return 1;
        }
        tvg.measurer = tvg_text_new();
        Clay_SetMeasureTextFunction(Clay_ThorVG_MeasureText, &tvg);
        if (window) {
            tvg_texture = SDL_CreateTexture(renderer, SDL_PIXELFORMAT_RGBA32, SDL_TEXTUREACCESS_STREAMING, tw, th);
            // ThorVG's WebGPU canvas renders premultiplied; the software canvas does not
            if (wg_target) SDL_SetTextureBlendMode(tvg_texture, SDL_BLENDMODE_BLEND_PREMULTIPLIED);
        }
    }

    if (window) printf("renderer: %s, raster: %s\n", SDL_GetRendererName(renderer), raster);

#ifdef PAGE_STATES
    // a scene: no window, no clock — every step at its frame, and the last frame written, dumped or compared
    if (scene) {
        Scene replay;
        char err[512];
        if (scene_read(scene, &replay, err, sizeof err)) {
            fprintf(stderr, "%s\n", err);
            return 1;
        }
        const Target target = {.thorvg = thorvg,
                               .wg = wg_target,
                               .tvg = &tvg,
                               .pixels = tvg_pixels,
                               .n = tw * th,
                               .sdl = &data,
                               .renderer = renderer,
                               .tw = tw,
                               .th = th};
        return run_scene(&replay, target, png, expect, dump);
    }
#else
    if (scene) {
        fprintf(stderr, "--scene needs a generated state machine: desktop/build.sh <example> --generated\n");
        return 2;
    }
#endif

    bool running = true, down = false;
    float px = -1, py = -1;
    int frame = 0;
    Uint64 last = SDL_GetTicks();
    while (running) {
        SDL_Event e;
        while (SDL_PollEvent(&e)) {
            if (e.type == SDL_EVENT_QUIT) running = false;
            if (e.type == SDL_EVENT_KEY_DOWN && !e.key.repeat) {
#ifdef PAGE_STATES
                if (e.key.key == 't') page_light = !page_light;
#else
                app_key((int)e.key.key);
#endif
            }
            if (e.type == SDL_EVENT_MOUSE_MOTION || e.type == SDL_EVENT_MOUSE_BUTTON_DOWN ||
                e.type == SDL_EVENT_MOUSE_BUTTON_UP) {
                SDL_ConvertEventToRenderCoordinates(renderer, &e);
                px = e.type == SDL_EVENT_MOUSE_MOTION ? e.motion.x : e.button.x;
                py = e.type == SDL_EVENT_MOUSE_MOTION ? e.motion.y : e.button.y;
                if (e.type == SDL_EVENT_MOUSE_BUTTON_DOWN) down = true;
                if (e.type == SDL_EVENT_MOUSE_BUTTON_UP) down = false;
            }
        }
        // a scripted click: frame 0 lays out (Clay hit-tests against the last frame's boxes), pressed in frame 1,
        // released in frame 2, and frame 3 is written; --press holds it from frame 1 and writes frame 2, still pressed
        // the pointer stays at X,Y for the written frame too (so a click frame is hovered, as a browser's is)
        if (headless && click_x >= 0 && frame <= 3) px = click_x, py = click_y, down = hold ? frame >= 1 : frame == 1;
        const Uint64 now = SDL_GetTicks();
        const float dt = (now - last) / 1000.0f;
        last = now;

#ifdef PAGE_STATES
        // the table's edge, after Clay's hit test of this position against the last frame's boxes (as page.c's
        // Clay_OnHover is) and before the frame it changes
#endif
        Clay_SetPointerState((Clay_Vector2){px, py}, down);
#ifdef PAGE_STATES
        page_dispatch(down ? 1 : 0);
#endif
        Clay_BeginLayout();
#ifdef PAGE_STATES
        PAGE_STATE(_frame)(page_state, page_light);
#else
        app_frame(down);
#endif
        Clay_RenderCommandArray cmds = Clay_EndLayout(dt);

        draw(thorvg, wg_target, &tvg, tvg_pixels, tw * th, &data, &cmds);
        if (tvg_texture) {
            SDL_UpdateTexture(tvg_texture, NULL, tvg_pixels, tw * 4);
            SDL_SetRenderDrawColor(renderer, 0, 0, 0, 255);
            SDL_RenderClear(renderer);
            SDL_RenderTexture(renderer, tvg_texture, NULL, NULL);
        }

        if (headless && click_x >= 0 && frame++ < (hold ? 2 : 3)) continue;
        if (headless && bench > 0) {
            const Uint64 t0 = SDL_GetTicksNS();
            for (int i = 0; i < bench; i++) {
                draw(thorvg, wg_target, &tvg, tvg_pixels, tw * th, &data, &cmds);
                if (!thorvg) SDL_FlushRenderer(renderer);
            }
            printf("%s: %.3f ms a frame (%d frames, %dx%d)\n", raster,
                   (SDL_GetTicksNS() - t0) / 1e6 / bench, bench, APP_W, APP_H);
        }
        if (headless) {
            SDL_Surface *got = thorvg ? SDL_CreateSurfaceFrom(tw, th, SDL_PIXELFORMAT_RGBA32, tvg_pixels, tw * 4)
                                      : frame_pixels(renderer);
            return finish(got, png, expect, dump, cmds, &tvg);
        }
        SDL_RenderPresent(renderer);
        SDL_Delay(16);
    }
    return 0;
}
