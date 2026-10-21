// A WebGPU device with an offscreen texture, and the readback of that texture into CPU pixels: what ThorVG's WebGPU
// canvas draws into (--raster thorvg-gpu). SDL3's GPU API has no WebGPU interop, so a frame comes back to the host as
// pixels and is shown through an SDL texture, exactly like the software canvas's buffer.
//
// Needs ThorVG built with -Dengines=wg against wgpu-native (desktop/build-thorvg-gpu.sh does that in $TMPDIR).
#include <webgpu/webgpu.h>
#include <SDL3/SDL.h>

typedef struct {
    WGPUInstance instance;
    WGPUAdapter adapter;
    WGPUDevice device;
    uint32_t w, h;
    WGPUTexture texture;
    WGPUBuffer buffer;   // the readback buffer, rows padded to 256 bytes as WebGPU demands
    uint32_t stride;     // the readback buffer's bytes a row
} Clay_WgTarget;

static void Clay_Wg_OnAdapter(WGPURequestAdapterStatus status, WGPUAdapter adapter, WGPUStringView message, void *user,
                              void *unused)
{
    (void)message, (void)unused;
    if (status == WGPURequestAdapterStatus_Success) *(WGPUAdapter *)user = adapter;
}

static void Clay_Wg_OnDevice(WGPURequestDeviceStatus status, WGPUDevice device, WGPUStringView message, void *user,
                             void *unused)
{
    (void)message, (void)unused;
    if (status == WGPURequestDeviceStatus_Success) *(WGPUDevice *)user = device;
}

static void Clay_Wg_OnError(WGPUDevice const *device, WGPUErrorType type, WGPUStringView message, void *user,
                            void *unused)
{
    (void)device, (void)user, (void)unused;
    SDL_Log("webgpu error %d: %.*s", (int)type, (int)message.length, message.data);
}

static void Clay_Wg_OnMap(WGPUMapAsyncStatus status, WGPUStringView message, void *user, void *unused)
{
    (void)message, (void)unused;
    *(int *)user = (int)status;
}

/** A device on the first adapter and a w x h texture to draw into; false if there is no WebGPU adapter here. */
static bool Clay_Wg_Create(Clay_WgTarget *t, uint32_t w, uint32_t h)
{
    t->w = w, t->h = h;
    t->stride = (w * 4 + 255) & ~255u;
    if (!(t->instance = wgpuCreateInstance(NULL))) return false;

    WGPURequestAdapterOptions options = {0};
    options.featureLevel = WGPUFeatureLevel_Compatibility;
    options.powerPreference = WGPUPowerPreference_HighPerformance;
    WGPURequestAdapterCallbackInfo on_adapter = {0};
    on_adapter.mode = WGPUCallbackMode_WaitAnyOnly;
    on_adapter.callback = Clay_Wg_OnAdapter;
    on_adapter.userdata1 = &t->adapter;
    wgpuInstanceRequestAdapter(t->instance, &options, on_adapter);
    if (!t->adapter) return false;

    WGPUDeviceDescriptor device = {0};
    device.label = (WGPUStringView){"cssints", WGPU_STRLEN};
    device.uncapturedErrorCallbackInfo.callback = Clay_Wg_OnError;
    WGPURequestDeviceCallbackInfo on_device = {0};
    on_device.mode = WGPUCallbackMode_WaitAnyOnly;
    on_device.callback = Clay_Wg_OnDevice;
    on_device.userdata1 = &t->device;
    wgpuAdapterRequestDevice(t->adapter, &device, on_device);
    if (!t->device) return false;

    // ThorVG's ABGR8888 is R,G,B,A in memory, which is what a RGBA8Unorm texture holds; it renders premultiplied
    WGPUTextureDescriptor tex = {0};
    tex.usage = WGPUTextureUsage_RenderAttachment | WGPUTextureUsage_CopySrc | WGPUTextureUsage_CopyDst;
    tex.dimension = WGPUTextureDimension_2D;
    tex.size = (WGPUExtent3D){w, h, 1};
    tex.format = WGPUTextureFormat_BGRA8Unorm; // ThorVG's WebGPU blit pipeline is built for BGRA targets
    tex.mipLevelCount = 1;
    tex.sampleCount = 1;
    t->texture = wgpuDeviceCreateTexture(t->device, &tex);

    WGPUBufferDescriptor buf = {0};
    buf.usage = WGPUBufferUsage_CopyDst | WGPUBufferUsage_MapRead;
    buf.size = (uint64_t)t->stride * h;
    t->buffer = wgpuDeviceCreateBuffer(t->device, &buf);
    return t->texture && t->buffer;
}

/** Copies the texture into the readback buffer and into pixels (RGBA32 rows, w * 4 bytes each). */
static bool Clay_Wg_Readback(Clay_WgTarget *t, Uint32 *pixels)
{
    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(t->device, NULL);
    WGPUTexelCopyTextureInfo from = {0};
    from.texture = t->texture;
    from.aspect = WGPUTextureAspect_All;
    WGPUTexelCopyBufferInfo to = {0};
    to.buffer = t->buffer;
    to.layout.bytesPerRow = t->stride;
    to.layout.rowsPerImage = t->h;
    wgpuCommandEncoderCopyTextureToBuffer(encoder, &from, &to, &(WGPUExtent3D){t->w, t->h, 1});
    WGPUCommandBuffer commands = wgpuCommandEncoderFinish(encoder, NULL);
    wgpuCommandEncoderRelease(encoder);
    wgpuQueueSubmit(wgpuDeviceGetQueue(t->device), 1, &commands);
    wgpuCommandBufferRelease(commands);

    int mapped = -1;
    WGPUBufferMapCallbackInfo on_map = {0};
    on_map.mode = WGPUCallbackMode_AllowProcessEvents;
    on_map.callback = Clay_Wg_OnMap;
    on_map.userdata1 = &mapped;
    wgpuBufferMapAsync(t->buffer, WGPUMapMode_Read, 0, (size_t)t->stride * t->h, on_map);
    // ponytail: a spin with a ceiling, no fence; a 4-deep ring of buffers if the wait ever shows up in a profile
    for (int i = 0; i < 100000 && mapped < 0; i++) wgpuInstanceProcessEvents(t->instance);
    if (mapped != WGPUMapAsyncStatus_Success) {
        SDL_Log("thorvg-gpu: readback map: %d", mapped);
        return false;
    }
    const Uint8 *src = wgpuBufferGetConstMappedRange(t->buffer, 0, (size_t)t->stride * t->h);
    if (!src) return false;
    // the texture is BGRA (ThorVG's blit pipeline's format), the buffer RGBA32: swap R and B on the way out
    for (uint32_t y = 0; y < t->h; y++) {
        const Uint8 *in = src + (size_t)y * t->stride;
        Uint8 *out = (Uint8 *)pixels + (size_t)y * t->w * 4;
        for (uint32_t x = 0; x < t->w; x++, in += 4, out += 4) {
            out[0] = in[2], out[1] = in[1], out[2] = in[0], out[3] = in[3];
        }
    }
    wgpuBufferUnmap(t->buffer);
    return true;
}
