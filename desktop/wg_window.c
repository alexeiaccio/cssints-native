// The experiment the WebGPU probe's verdict asked for: ThorVG draws into the window's own WebGPU surface and the frame
// is presented there, so no frame comes back to the CPU — no copy to a buffer, no map, no swizzle, no SDL texture
// upload. A separate binary on purpose (desktop/build-wg-window.sh): the default paths of host.c do not change.
//
// SDL3's GPU API cannot host a WebGPU texture (its Metal texture is not a wgpu texture), so the window is SDL's only for
// the events and the CAMetalLayer it puts on screen (SDL_Metal_CreateView); wgpu-native wraps that layer in a
// WGPUSurface, and ThorVG's WebGPU canvas draws into it (tvg_wgcanvas_set_target type 0): each sync acquires the
// current swapchain texture, blits its offscreen root into it and submits. This loop calls wgpuSurfacePresent.
//
//   wg_window                     a window, the Sensors page; `t` toggles the theme, `q` quits
//   wg_window --bench N           N uncapped frames, prints ms a frame (layout, ThorVG's submit, present) and the fps
//   wg_window --size W H          the surface's own pixels (default 360x360)
//   wg_window --capture out.png   one frame, drawn into a swapchain texture this file acquires itself (type 1) so it
//                                 can be copied back and saved: a test-only readback, before that frame is presented.
//                                 --expect ref.png compares it with ref.png and exits 1 on a difference
#define CLAY_IMPLEMENTATION
#include "clay.h"

#include <SDL3/SDL.h>
#include <SDL3/SDL_metal.h>
#include <SDL3_image/SDL_image.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <webgpu/webgpu.h>

#include "clay_renderer_thorvg.c"

void app_frame(bool down);
void app_key(int key); // the same callback host.c calls: the SDL keycode (a letter is its ASCII code)

static int wg_errors, clay_errors;

static void on_wgpu_error(WGPUDevice const *device, WGPUErrorType type, WGPUStringView message, void *user,
                          void *unused)
{
    (void)device, (void)user, (void)unused;
    wg_errors++;
    SDL_Log("webgpu error %d: %.*s", (int)type, (int)message.length, message.data);
}

static void on_clay_error(Clay_ErrorData e)
{
    clay_errors++;
    fprintf(stderr, "clay error %d: %.*s\n", (int)e.errorType, (int)e.errorText.length, e.errorText.chars);
}

static void on_map(WGPUMapAsyncStatus status, WGPUStringView message, void *user, void *unused)
{
    (void)message, (void)unused;
    *(int *)user = (int)status;
}

static void on_adapter(WGPURequestAdapterStatus status, WGPUAdapter adapter, WGPUStringView message, void *user,
                       void *unused)
{
    (void)message, (void)unused;
    if (status == WGPURequestAdapterStatus_Success) *(WGPUAdapter *)user = adapter;
}

static void on_device(WGPURequestDeviceStatus status, WGPUDevice device, WGPUStringView message, void *user,
                      void *unused)
{
    (void)message, (void)unused;
    if (status == WGPURequestDeviceStatus_Success) *(WGPUDevice *)user = device;
}

typedef struct {
    WGPUInstance instance;
    WGPUAdapter adapter;
    WGPUDevice device;
    WGPUSurface surface;
    WGPUAdapterInfo info;
} Wg;

/** The wgpu state over a CAMetalLayer: an instance, the first adapter, a device, and the surface on that layer. */
static bool wg_init(Wg *wg, void *layer)
{
    if (!(wg->instance = wgpuCreateInstance(NULL))) {
        fprintf(stderr, "wg: no instance\n");
        return false;
    }
    WGPURequestAdapterOptions options = {0};
    options.featureLevel = WGPUFeatureLevel_Compatibility;
    options.powerPreference = WGPUPowerPreference_HighPerformance;
    WGPURequestAdapterCallbackInfo on_adapter_info = {0};
    on_adapter_info.mode = WGPUCallbackMode_WaitAnyOnly;
    on_adapter_info.callback = on_adapter;
    on_adapter_info.userdata1 = &wg->adapter;
    wgpuInstanceRequestAdapter(wg->instance, &options, on_adapter_info);
    if (!wg->adapter) {
        fprintf(stderr, "wg: no WebGPU adapter\n");
        return false;
    }
    wgpuAdapterGetInfo(wg->adapter, &wg->info);

    WGPUDeviceDescriptor device = {0};
    device.label = (WGPUStringView){"cssints-wg-window", WGPU_STRLEN};
    device.uncapturedErrorCallbackInfo.callback = on_wgpu_error;
    WGPURequestDeviceCallbackInfo on_device_info = {0};
    on_device_info.mode = WGPUCallbackMode_WaitAnyOnly;
    on_device_info.callback = on_device;
    on_device_info.userdata1 = &wg->device;
    wgpuAdapterRequestDevice(wg->adapter, &device, on_device_info);
    if (!wg->device) {
        fprintf(stderr, "wg: no device\n");
        return false;
    }

    // macOS: the surface is a CAMetalLayer, which SDL_Metal_CreateView puts behind the window's view
    WGPUSurfaceSourceMetalLayer metal = WGPU_SURFACE_SOURCE_METAL_LAYER_INIT;
    metal.layer = layer;
    WGPUSurfaceDescriptor desc = WGPU_SURFACE_DESCRIPTOR_INIT;
    desc.nextInChain = &metal.chain;
    if (!(wg->surface = wgpuInstanceCreateSurface(wg->instance, &desc))) {
        fprintf(stderr, "wg: no surface from the CAMetalLayer\n");
        return false;
    }
    return true;
}

/** Configures the surface and waits for a drawable: a layer has none until SDL has mapped the window, and a swapchain
 *  that is not on screen answers Occluded. Throws away the drawables it fails to get, so the caller's first frame is
 *  a frame of its own. */
static WGPUSurfaceTexture wg_wait_frame(Wg *wg, uint32_t w, uint32_t h, WGPUCompositeAlphaMode alpha,
                                       WGPUTextureUsage usage)
{
    WGPUSurfaceConfiguration config = {
        .device = wg->device,
        .format = WGPUTextureFormat_BGRA8Unorm, // ThorVG's blit pipeline is built for BGRA
        .usage = usage,
        .width = w,
        .height = h,
        .alphaMode = alpha,
        .presentMode = WGPUPresentMode_Immediate, // no vsync wait: the point is to time the frame, not the display
    };
    wgpuSurfaceConfigure(wg->surface, &config);
    WGPUSurfaceTexture st = {0};
    for (int i = 0; i < 200; i++) {
        wgpuSurfaceGetCurrentTexture(wg->surface, &st);
        if (st.texture) break;
        SDL_PumpEvents();
        SDL_Delay(10);
    }
    return st;
}

/** A surface texture to draw into, with the layout its copy back needs. */
typedef struct {
    uint32_t w, h, stride;
    WGPUTexture texture;
} Wg_Frame;

/** That texture as RGBA32 pixels: a copy to a buffer and a map. Only --capture does this; the loop never does. */
static bool wg_readback(Wg *wg, Wg_Frame *f, Uint32 *pixels)
{
    WGPUBufferDescriptor buf = {0};
    buf.usage = WGPUBufferUsage_CopyDst | WGPUBufferUsage_MapRead;
    buf.size = (uint64_t)f->stride * f->h;
    WGPUBuffer buffer = wgpuDeviceCreateBuffer(wg->device, &buf);
    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(wg->device, NULL);
    WGPUTexelCopyTextureInfo from = {0};
    from.texture = f->texture;
    from.aspect = WGPUTextureAspect_All;
    WGPUTexelCopyBufferInfo to = {0};
    to.buffer = buffer;
    to.layout.bytesPerRow = f->stride;
    to.layout.rowsPerImage = f->h;
    wgpuCommandEncoderCopyTextureToBuffer(encoder, &from, &to, &(WGPUExtent3D){f->w, f->h, 1});
    WGPUCommandBuffer commands = wgpuCommandEncoderFinish(encoder, NULL);
    wgpuCommandEncoderRelease(encoder);
    wgpuQueueSubmit(wgpuDeviceGetQueue(wg->device), 1, &commands);
    wgpuCommandBufferRelease(commands);

    int mapped = -1;
    WGPUBufferMapCallbackInfo on_map_info = {0};
    on_map_info.mode = WGPUCallbackMode_AllowProcessEvents;
    on_map_info.callback = on_map;
    on_map_info.userdata1 = &mapped;
    wgpuBufferMapAsync(buffer, WGPUMapMode_Read, 0, (size_t)f->stride * f->h, on_map_info);
    for (int i = 0; i < 100000 && mapped < 0; i++) wgpuInstanceProcessEvents(wg->instance);
    const Uint8 *src = mapped == WGPUMapAsyncStatus_Success
                           ? wgpuBufferGetConstMappedRange(buffer, 0, (size_t)f->stride * f->h)
                           : NULL;
    if (!src) {
        fprintf(stderr, "capture: readback map: %d\n", mapped);
        return false;
    }
    // BGRA in the drawable, RGBA32 in pixels
    for (uint32_t y = 0; y < f->h; y++) {
        const Uint8 *in = src + (size_t)y * f->stride;
        Uint8 *out = (Uint8 *)pixels + (size_t)y * f->w * 4;
        for (uint32_t x = 0; x < f->w; x++, in += 4, out += 4)
            out[0] = in[2], out[1] = in[1], out[2] = in[0], out[3] = in[3];
    }
    wgpuBufferUnmap(buffer);
    wgpuBufferRelease(buffer);
    return true;
}

typedef struct {
    Wg *wg;
    Clay_ThorVGRendererData *tvg;
    double ms_layout, ms_draw, ms_present;
    int frames;
    // the pointer, as SDL reports it: window coordinates are Clay's units here (no high-DPI flag on the window), and a
    // press is `down` for the frame, so `.active` and a click behave as on the SDL host
    float px, py;
    bool down;
} Loop;

/** One frame: Clay's layout, ThorVG's walk (which builds the scene, draws and syncs into the target — the submit),
 *  then present. With `copied`, the target is read back before it is presented (--capture only). */
static bool frame(Loop *l, float dt, Wg_Frame *copied, Uint32 *pixels)
{
    Uint64 t0 = SDL_GetTicksNS();
    Clay_SetPointerState((Clay_Vector2){l->px, l->py}, l->down);
    Clay_BeginLayout();
    app_frame(l->down);
    Clay_RenderCommandArray cmds = Clay_EndLayout(dt);
    Uint64 t1 = SDL_GetTicksNS();
    const bool synced = Clay_ThorVG_RenderClayCommands(l->tvg, &cmds);
    Uint64 t2 = SDL_GetTicksNS();
    const bool read = copied ? wg_readback(l->wg, copied, pixels) : true;
    const WGPUStatus presented = wgpuSurfacePresent(l->wg->surface);
    wgpuInstanceProcessEvents(l->wg->instance); // the present's completion is delivered here, as wgpu-native asks
    Uint64 t3 = SDL_GetTicksNS();
    l->ms_layout += (t1 - t0) / 1e6, l->ms_draw += (t2 - t1) / 1e6, l->ms_present += (t3 - t2) / 1e6;
    l->frames++;
    if (!synced || !read || presented != WGPUStatus_Success) {
        WGPUSurfaceTexture probe = {0};
        wgpuSurfaceGetCurrentTexture(l->wg->surface, &probe);
        fprintf(stderr, "frame %d: thorvg sync %s, present %s (%d); next acquire would be %d\n", l->frames,
                synced ? "ok" : "FAILED", presented == WGPUStatus_Success ? "ok" : "FAILED", (int)presented,
                (int)probe.status);
        if (probe.texture) wgpuSurfacePresent(l->wg->surface);
        return false;
    }
    return true;
}

/** Channels that differ between two RGBA32 surfaces of one size, and their mean difference per channel; -1: no match. */
static long differ(SDL_Surface *a, SDL_Surface *b, double *mean, int *worst)
{
    if (a->w != b->w || a->h != b->h) return -1;
    long n = 0, sum = 0;
    *worst = 0;
    for (int y = 0; y < a->h; y++) {
        const Uint8 *pa = (const Uint8 *)a->pixels + y * a->pitch;
        const Uint8 *pb = (const Uint8 *)b->pixels + y * b->pitch;
        for (int x = 0; x < a->w * 4; x++) {
            const int d = (int)pa[x] - (int)pb[x], ad = d < 0 ? -d : d;
            sum += ad;
            n += d != 0;
            if (ad > *worst) *worst = ad;
        }
    }
    *mean = (double)sum / ((double)a->w * a->h * 4);
    return n;
}

int main(int argc, char **argv)
{
    int w = 360, h = 360, bench = 0, novsync = 0;
    const char *capture = NULL, *expect = NULL;
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--bench") && i + 1 < argc) bench = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--size") && i + 2 < argc) w = atoi(argv[++i]), h = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--capture") && i + 1 < argc) capture = argv[++i];
        else if (!strcmp(argv[i], "--expect") && i + 1 < argc) expect = argv[++i];
        else if (!strcmp(argv[i], "--novsync")) novsync = 1;
        else {
            fprintf(stderr, "usage: wg_window [--size W H] [--bench N] [--novsync]"
                            " [--capture out.png [--expect ref.png]]\n");
            return 2;
        }
    }

    if (!SDL_Init(SDL_INIT_VIDEO)) {
        fprintf(stderr, "init: %s\n", SDL_GetError());
        return 1;
    }
    SDL_Window *window = SDL_CreateWindow("cssints-native: WebGPU surface", w, h, SDL_WINDOW_METAL);
    // A CAMetalLayer that nothing can see hands out no drawable (Metal's nextDrawable is nil, wgpu's Occluded), and a
    // window behind another one counts as unseen: raise it, and pump until SDL has mapped it. Only for this experiment.
    // Not resizable: the surface is configured once, for `--size`, and a resize would leave ThorVG's target behind it.
    SDL_SetWindowAlwaysOnTop(window, true);
    SDL_SetWindowResizable(window, false);
    SDL_RaiseWindow(window);
    for (int i = 0; window && i < 30; i++) {
        SDL_PumpEvents();
        SDL_Delay(20);
    }
    SDL_MetalView view = window ? SDL_Metal_CreateView(window) : NULL;
    void *layer = view ? SDL_Metal_GetLayer(view) : NULL;
    if (!layer) {
        fprintf(stderr, "window or Metal layer: %s\n", SDL_GetError());
        return 1;
    }

    Wg wg = {0};
    if (!wg_init(&wg, layer)) return 2;

    // what the layer offers, printed as the evidence it is: ThorVG's blit pipeline needs BGRA8Unorm
    WGPUSurfaceCapabilities caps = {0};
    if (wgpuSurfaceGetCapabilities(wg.surface, wg.adapter, &caps) != WGPUStatus_Success) {
        fprintf(stderr, "wg: the surface has no capabilities (an unsupported layer?)\n");
        return 2;
    }
    bool bgra = false;
    // a present mode that does not wait for the display, if the layer has one: Fifo is always there
    WGPUPresentMode unlock = WGPUPresentMode_Fifo;
    for (size_t i = 0; i < caps.formatCount; i++) bgra |= caps.formats[i] == WGPUTextureFormat_BGRA8Unorm;
    for (size_t i = 0; i < caps.presentModeCount; i++)
        if (caps.presentModes[i] != WGPUPresentMode_Fifo) unlock = caps.presentModes[i];
    printf("surface: %dx%d, %zu formats (bgra8unorm %s), %zu alpha modes, %zu present modes\n", w, h, caps.formatCount,
           bgra ? "yes" : "NO", caps.alphaModeCount, caps.presentModeCount);
    printf("adapter: %.*s (%.*s), backend %d\n", (int)wg.info.device.length, wg.info.device.data,
           (int)wg.info.description.length, wg.info.description.data, (int)wg.info.backendType);
    wgpuSurfaceCapabilitiesFreeMembers(caps);
    if (!bgra) {
        fprintf(stderr, "wg: the surface cannot be BGRA8Unorm, which ThorVG's WebGPU blit pipeline needs\n");
        return 2;
    }
    // ThorVG renders premultiplied; Metal offers Opaque and PostMultiplied, and wgpu's Auto resolves to Opaque
    const WGPUCompositeAlphaMode alpha = WGPUCompositeAlphaMode_Opaque;
    const WGPUTextureUsage usage =
        WGPUTextureUsage_RenderAttachment | (capture ? WGPUTextureUsage_CopySrc : (WGPUTextureUsage)0);

    if (tvg_engine_init(0) || tvg_font_load(FONT_PATH)) {
        fprintf(stderr, "thorvg: no engine or no font %s\n", FONT_PATH);
        return 1;
    }
    const char *tvg_fonts[1] = {"Roboto-Regular"};
    // the surface is w x h device pixels, so ThorVG's scale is 1: Clay's units are the presentable pixels
    Clay_ThorVGRendererData tvg = {.scale = 1, .fonts = tvg_fonts, .clear = true};
    tvg.canvas = tvg_wgcanvas_create(TVG_ENGINE_OPTION_DEFAULT);
    if (!tvg.canvas) {
        fprintf(stderr, "thorvg: no WebGPU canvas: needs a ThorVG built with -Dengines=wg and wgpu-native, as "
                        "desktop/build-thorvg-gpu.sh does\n");
        return 2;
    }

    uint32_t size = Clay_MinMemorySize();
    Clay_Initialize(Clay_CreateArenaWithCapacityAndMemory(size, malloc(size)), (Clay_Dimensions){(float)w, (float)h},
                    (Clay_ErrorHandler){on_clay_error});
    tvg.measurer = tvg_text_new(); // text is measured by ThorVG, as it draws it
    Clay_SetMeasureTextFunction(Clay_ThorVG_MeasureText, &tvg);

    // the first drawable: the layer has none until the window is on screen, and its swapchain must be configured
    WGPUSurfaceTexture first = wg_wait_frame(&wg, (uint32_t)w, (uint32_t)h, alpha, usage);
    if (!first.texture) {
        fprintf(stderr, "surface: no drawable after 2 s (status %d): the window is not on screen, so nothing can be "
                        "presented to it\n", (int)first.status);
        return 2;
    }

    // the target: for the loop, ThorVG's own surface path (type 0), where its sync acquires and blits the swapchain
    // texture; for --capture, the texture this file acquired (type 1), so the frame can be copied back before present
    Wg_Frame frame_target = {.w = (uint32_t)w, .h = (uint32_t)h, .stride = ((uint32_t)w * 4 + 255) & ~255u};
    if (capture) {
        frame_target.texture = first.texture;
    } else {
        wgpuSurfacePresent(wg.surface); // that first drawable held nothing: show it, and let ThorVG reconfigure
        wgpuTextureRelease(first.texture);
    }
    Tvg_Result tr = tvg_wgcanvas_set_target(tvg.canvas, wg.device, wg.instance,
                                            capture ? (void *)frame_target.texture : (void *)wg.surface,
                                            (uint32_t)w, (uint32_t)h, TVG_COLORSPACE_ABGR8888, capture ? 1 : 0);
    if (tr != TVG_RESULT_SUCCESS) {
        fprintf(stderr, "tvg_wgcanvas_set_target(type %d): %d — ThorVG's WebGPU canvas refused the %s\n",
                capture ? 1 : 0, (int)tr, capture ? "surface texture" : "surface");
        return 2;
    }

    if (novsync && !capture) {
        // ThorVG configured the surface with Immediate; a CAMetalLayer still throttles to its display, so ask for the
        // layer's non-Fifo mode on top: the point is to time the CPU work, not the display
        WGPUSurfaceConfiguration config = {
            .device = wg.device,
            .format = WGPUTextureFormat_BGRA8Unorm,
            .usage = WGPUTextureUsage_RenderAttachment,
            .width = (uint32_t)w,
            .height = (uint32_t)h,
            .alphaMode = alpha,
            .presentMode = unlock,
        };
        wgpuSurfaceConfigure(wg.surface, &config);
        printf("present: reconfigured with mode %d\n", (int)unlock);
    }

    Loop loop = {.wg = &wg, .tvg = &tvg};
    // warm up: a few frames with the pipelines' caches cold, before the timed ones
    for (int i = 0; bench > 0 && i < 4; i++)
        if (!frame(&loop, 1 / 60.0f, NULL, NULL)) return 1;
    loop.ms_layout = loop.ms_draw = loop.ms_present = 0, loop.frames = 0;
    if (capture) {
        Uint32 *pixels = malloc((size_t)w * h * 4);
        if (!frame(&loop, 1 / 60.0f, &frame_target, pixels)) return 1;
        SDL_Surface *got = SDL_CreateSurfaceFrom(w, h, SDL_PIXELFORMAT_RGBA32, pixels, w * 4);
        int status = wg_errors ? 1 : 0;
        if (!IMG_SavePNG(got, capture)) {
            fprintf(stderr, "%s: %s\n", capture, SDL_GetError());
            status = 1;
        }
        if (expect) {
            SDL_Surface *ref0 = IMG_Load(expect);
            SDL_Surface *ref = ref0 ? SDL_ConvertSurface(ref0, SDL_PIXELFORMAT_RGBA32) : NULL;
            double mean = 0;
            int worst = 0;
            const long n = ref ? differ(got, ref, &mean, &worst) : -1;
            // the probe's finding: the same frame, but the GPU anti-aliases edges its own way
            if (n < 0 || mean > 0.5 || worst > 128) {
                fprintf(stderr, "%s: %ld channels differ, mean %g/255, worst %d/255\n", expect, n, mean, worst);
                status = 1;
            } else {
                printf("%s: %ld of %ld channels differ, mean %g/255, worst %d/255\n", expect, n,
                       (long)w * h * 4, mean, worst);
            }
        }
        return status;
    }

    bool running = true;
    Uint64 last = SDL_GetTicks();
    while (running) {
        SDL_Event e;
        while (SDL_PollEvent(&e)) {
            if (e.type == SDL_EVENT_QUIT) running = false;
            if (e.type == SDL_EVENT_KEY_DOWN && !e.key.repeat) {
                app_key((int)e.key.key);
                if (e.key.key == 'q') running = false;
            }
            if (e.type == SDL_EVENT_MOUSE_MOTION) loop.px = e.motion.x, loop.py = e.motion.y;
            if (e.type == SDL_EVENT_MOUSE_BUTTON_DOWN) loop.px = e.button.x, loop.py = e.button.y, loop.down = true;
            if (e.type == SDL_EVENT_MOUSE_BUTTON_UP) loop.px = e.button.x, loop.py = e.button.y, loop.down = false;
            if (e.type == SDL_EVENT_WINDOW_MOUSE_LEAVE) loop.px = -1, loop.py = -1, loop.down = false;
        }
        const Uint64 now = SDL_GetTicks();
        const float dt = (now - last) / 1000.0f;
        last = now;
        if (!frame(&loop, dt, NULL, NULL)) return 1;
        if (bench && loop.frames >= bench) running = false;
        if (!bench) SDL_Delay(1); // let the compositor breathe; --bench runs it uncapped to time it
    }

    if (bench > 0 && loop.frames > 0) {
        const double n = loop.frames;
        const double total = (loop.ms_layout + loop.ms_draw + loop.ms_present) / n;
        printf("wg-surface: %.3f ms a frame (%d frames, %dx%d): layout %.3f, thorvg sync+submit %.3f, present %.3f"
               " (%.0f fps)\n",
               total, loop.frames, w, h, loop.ms_layout / n, loop.ms_draw / n, loop.ms_present / n, 1000.0 / total);
    }
    printf("frames: %d, wgpu errors: %d, clay errors: %d\n", loop.frames, wg_errors, clay_errors);
    return wg_errors || clay_errors ? 1 : 0;
}
