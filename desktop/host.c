// The desktop host: an SDL3 window, Clay's layout, Clay's SDL3 renderer (Metal on a Mac). The page is linked in:
// it defines app_frame(), which declares the Clay tree of one frame.
//
//   host                    a window; the mouse is the pointer
//   host --png out.png      one frame headless (the software renderer on a surface), written to out.png
//   host --expect ref.png   the same frame compared with ref.png pixel for pixel; exit 1 and write
//                           ref.png.actual.png on a difference
//   --click X Y             headless: a press and a release at X,Y before the frame that is written
#define CLAY_IMPLEMENTATION
#include "clay.h"

#include <SDL3/SDL.h>
#include <SDL3_image/SDL_image.h>
#include <SDL3_ttf/SDL_ttf.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "clay_renderer_SDL3.c"

#ifndef APP_W
#define APP_W 360
#define APP_H 360
#endif

void app_frame(bool down);

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

int main(int argc, char **argv)
{
    const char *png = NULL, *expect = NULL;
    float click_x = -1, click_y = -1;
    for (int i = 1; i + 1 < argc; i++) {
        if (!strcmp(argv[i], "--click") && i + 2 < argc) {
            click_x = strtof(argv[++i], NULL), click_y = strtof(argv[++i], NULL);
            continue;
        }
        if (!strcmp(argv[i], "--png")) png = argv[++i];
        else if (!strcmp(argv[i], "--expect")) expect = argv[++i];
    }
    const bool headless = png || expect;
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

    if (window) printf("renderer: %s\n", SDL_GetRendererName(renderer));

    bool running = true, down = false;
    float px = -1, py = -1;
    int frame = 0;
    Uint64 last = SDL_GetTicks();
    while (running) {
        SDL_Event e;
        while (SDL_PollEvent(&e)) {
            if (e.type == SDL_EVENT_QUIT) running = false;
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
        // released in frame 2, and frame 3 is written
        if (headless && click_x >= 0 && frame < 3) px = click_x, py = click_y, down = frame == 1;
        const Uint64 now = SDL_GetTicks();
        const float dt = (now - last) / 1000.0f;
        last = now;

        Clay_SetPointerState((Clay_Vector2){px, py}, down);
        Clay_BeginLayout();
        app_frame(down);
        Clay_RenderCommandArray cmds = Clay_EndLayout(dt);

        SDL_SetRenderDrawColor(renderer, 0, 0, 0, 255);
        SDL_RenderClear(renderer);
        SDL_Clay_RenderClayCommands(&data, &cmds);

        if (headless && click_x >= 0 && frame++ < 3) continue;
        if (headless) {
            SDL_Surface *got = frame_pixels(renderer);
            int status = errors ? 1 : 0;
            if (png) IMG_SavePNG(got, png);
            if (expect) {
                SDL_Surface *ref0 = IMG_Load(expect);
                SDL_Surface *ref = ref0 ? SDL_ConvertSurface(ref0, SDL_PIXELFORMAT_RGBA32) : NULL;
                const long n = ref ? differ(got, ref) : -1;
                if (n) {
                    char out[1024];
                    snprintf(out, sizeof out, "%s.actual.png", expect);
                    IMG_SavePNG(got, out);
                    fprintf(stderr, "%s: %ld pixels differ (-1: missing or another size); this frame is %s\n",
                            expect, n, out);
                    status = 1;
                } else {
                    printf("%s: identical, %d commands\n", expect, cmds.length);
                }
            }
            return status;
        }
        SDL_RenderPresent(renderer);
        SDL_Delay(16);
    }
    return 0;
}
