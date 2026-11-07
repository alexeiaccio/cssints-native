// The nicegraf spike: the Sensors frame's rectangles through one pipeline, one vertex buffer, one draw call, into a
// 360x360 offscreen target on Metal, and the numbers (draw, draw+wait, draw+copy+wait+map). No glyphs, no AA, no
// borders as rings, no gradients: those are what a renderer on top of this would still owe.
//
//   quad --png out.png            one frame, written
//   quad --bench N                N frames a phase, median of 5 runs, the ms table
//
// Shaders are MSL text handed to ngf_create_shader_stage: nicegraf's Metal backend compiles the string with
// newLibrary, so the spike keeps its shader in this file (no niceshade, no HLSL, no SPIR-V).
#include <nicegraf.h>
#include <nicegraf-util.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <stdarg.h>
#include <zlib.h>

#define W 360
#define H 360
// solid/goldens/sensors.json has ten commands: seven are text, three are rectangles. These six quads are those
// three (the border is four 1px strips, square corners: a real renderer owes the even-odd ring and the radius).
#define NCOMMANDS 6

typedef struct { float x, y, w, h; unsigned char r, g, b, a; } rect;
static const rect RECTS[NCOMMANDS] = {
    {0, 0, 360, 360, 16, 18, 24, 255},
    {80, 228.625f, 200, 38, 36, 40, 52, 255},
    {80, 228.625f, 1, 38, 150, 155, 170, 255},
    {279, 228.625f, 1, 38, 150, 155, 170, 255},
    {80, 228.625f, 200, 1, 150, 155, 170, 255},
    {80, 265.625f, 200, 1, 150, 155, 170, 255},
};

#define MAXQUADS (NCOMMANDS + 4096)
// Two float4s a vertex: position and colour, so the C struct and MSL's alignment agree (an MSL float2+float4
// struct is 32 bytes, not 24).
static float VERTS[MAXQUADS * 6 * 8];
static uint32_t nquads = NCOMMANDS;

// The backend wants a NGF_NATIVE_BINDING_MAP comment (niceshade writes one); this pipeline binds no
// descriptor sets, so the map is empty.
static const char *VS = "/* NGF_NATIVE_BINDING_MAP\n*/\n"
                        "#include <metal_stdlib>\n"
                        "using namespace metal;\n"
                        "struct V { float2 pos; float4 col; };\n"
                        "struct O { float4 pos [[position]]; float4 col; };\n"
                        "vertex O vmain(const device float4* v [[buffer(30)]], uint id [[vertex_id]]) {\n"
                        "  float4 p = v[2 * id];\n"
                        "  O o; o.pos = float4(p.xy, 0.0, 1.0); o.col = v[2 * id + 1]; return o;\n"
                        "}\n";
static const char *FS = "/* NGF_NATIVE_BINDING_MAP\n*/\n"
                        "#include <metal_stdlib>\n"
                        "using namespace metal;\n"
                        "struct O { float4 pos [[position]]; float4 col; };\n"
                        "fragment float4 fmain(O in [[stage_in]]) { return in.col; }\n";

static int failures = 0;
#define CHECK(e)                                                                                                   \
  do {                                                                                                             \
    ngf_error err_ = (e);                                                                                          \
    if (err_ != NGF_ERROR_OK) {                                                                                    \
      fprintf(stderr, "quad: %s failed: %s\n", #e, ngf_util_get_error_name(err_));                                  \
      return 1;                                                                                                    \
    }                                                                                                              \
  } while (0)

static void diag(ngf_diagnostic_message_type, void *, const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  vfprintf(stderr, fmt, ap);
  va_end(ap);
  fputc('\n', stderr);
}

static double now_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (double)ts.tv_sec * 1e3 + (double)ts.tv_nsec / 1e6;
}

static int cmp_double(const void *a, const void *b) {
  double x = *(const double *)a, y = *(const double *)b;
  return (x > y) - (x < y);
}
static double median(double *v, int n) {
  qsort(v, (size_t)n, sizeof(double), cmp_double);
  return n % 2 ? v[n / 2] : 0.5 * (v[n / 2 - 1] + v[n / 2]);
}

// A PNG of the frame: RGBA rows, filter 0, one zlib stream. 40 lines, enough to look at the picture.
static void write_png(const char *path, const unsigned char *rgba, int w, int h) {
  size_t raw_n = (size_t)h * (1 + (size_t)w * 4);
  unsigned char *raw = (unsigned char *)calloc(raw_n, 1);
  // Metal's first row is the bottom one; a PNG's is the top one.
  for (int y = 0; y < h; y++)
    memcpy(raw + (size_t)y * (1 + (size_t)w * 4) + 1, rgba + (size_t)(h - 1 - y) * (size_t)w * 4, (size_t)w * 4);
  uLongf z_n = compressBound((uLong)raw_n);
  unsigned char *z = (unsigned char *)malloc(z_n);
  compress2(z, &z_n, raw, (uLong)raw_n, 9);
  FILE *f = fopen(path, "wb");
  if (!f) { fprintf(stderr, "quad: cannot write %s\n", path); failures++; return; }
  unsigned char sig[8] = {137, 80, 78, 71, 13, 10, 26, 10};
  fwrite(sig, 1, 8, f);
  unsigned char ihdr[13] = {0, 0, (unsigned char)(w >> 8), (unsigned char)w, 0, 0,
                            (unsigned char)(h >> 8), (unsigned char)h, 8, 6, 0, 0, 0};
  unsigned char *buf = (unsigned char *)malloc(z_n + 12);
  for (int chunk = 0; chunk < 3; chunk++) {
    const unsigned char *data = chunk == 0 ? ihdr : z;
    size_t n = chunk == 0 ? 13 : (chunk == 1 ? z_n : 0);
    if (chunk == 2) {
      // IEND has no payload; its name goes in the same field.
      data = (const unsigned char *)"IEND";
      n = 0;
    } else if (chunk == 0) {
      memcpy(buf, "IHDR", 4);
    } else {
      memcpy(buf, "IDAT", 4);
    }
    unsigned char hdr[4] = {(unsigned char)(n >> 24), (unsigned char)(n >> 16), (unsigned char)(n >> 8), (unsigned char)n};
    memcpy(buf + 4, data, n);
    unsigned long crc = crc32(0, buf, (uInt)(4 + n));
    unsigned char c[4] = {(unsigned char)(crc >> 24), (unsigned char)(crc >> 16), (unsigned char)(crc >> 8), (unsigned char)crc};
    fwrite(hdr, 1, 4, f);
    fwrite(buf, 1, 4 + n, f);
    fwrite(c, 1, 4, f);
  }
  fclose(f);
  free(buf);
  free(z);
  free(raw);
}

int main(int argc, char **argv) {
  const char *png = NULL, *raw = NULL;
  int bench = 0, grid = 0;
  for (int i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "--png") && i + 1 < argc) png = argv[++i];
    else if (!strcmp(argv[i], "--bench") && i + 1 < argc) bench = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--raw") && i + 1 < argc) raw = argv[++i];
    else if (!strcmp(argv[i], "--grid") && i + 1 < argc) grid = atoi(argv[++i]);  // + N small quads: the crossover
  }

  // A grid of N quads over the page, for the frame that is many shapes and little else.
  static rect gridded[4096];
  if (grid > 4096) grid = 4096;
  if (grid > 0) {
    int cols = 1;
    while (cols * cols < grid) cols++;
    const float cell = 360.0f / (float)cols;
    for (int i = 0; i < grid; i++) {
      gridded[i] = (rect){(float)(i % cols) * cell + 1, (float)(i / cols) * cell + 1, cell - 2, cell - 2,
                          (unsigned char)(40 + (i * 37) % 200), (unsigned char)(30 + (i * 71) % 200),
                          (unsigned char)(60 + (i * 113) % 180), 255};
    }
    nquads = NCOMMANDS + (uint32_t)grid;
  }

  // The page's rectangles as two triangles each, in clip space (Clay's y grows down).
  for (int i = 0; i < (int)nquads; i++) {
    const rect *q = i < NCOMMANDS ? &RECTS[i] : &gridded[i - NCOMMANDS];
    float x0 = q->x / (W / 2.0f) - 1.0f, x1 = (q->x + q->w) / (W / 2.0f) - 1.0f;
    float y0 = 1.0f - q->y / (H / 2.0f), y1 = 1.0f - (q->y + q->h) / (H / 2.0f);
    float c[4] = {q->r / 255.0f, q->g / 255.0f, q->b / 255.0f, q->a / 255.0f};
    float p[6][2] = {{x0, y0}, {x1, y0}, {x1, y1}, {x0, y0}, {x1, y1}, {x0, y1}};
    for (int v = 0; v < 6; v++) {
      float *out = &VERTS[(i * 6 + v) * 8];
      out[0] = p[v][0]; out[1] = p[v][1]; out[2] = 0; out[3] = 0;
      out[4] = c[0]; out[5] = c[1]; out[6] = c[2]; out[7] = c[3];
    }
  }

  ngf_device_handle devices[8] = {0};
  uint32_t ndev = 0;
  const ngf_device *devs = NULL;
  CHECK(ngf_get_device_list(&devs, &ndev));
  if (ndev == 0) { fprintf(stderr, "quad: no Metal device\n"); return 1; }
  devices[0] = devs[0].handle;
  const ngf_diagnostic_info diag_info = {NGF_DIAGNOSTICS_VERBOSITY_DETAILED, NULL, diag, false};
  const ngf_init_info init = {&diag_info, NULL, devices[0], NULL};
  CHECK(ngf_initialize(&init));
  printf("quad: device %s\n", devs[0].name);

  ngf_context ctx = NULL;
  const ngf_context_info cinfo = {NULL, NULL};  // offscreen only: no swapchain
  CHECK(ngf_create_context(&cinfo, &ctx));
  ngf_set_context(ctx);

  ngf_image img = NULL;
  const ngf_image_info iinfo = {NGF_IMAGE_TYPE_IMAGE_2D, {W, H, 1u}, 1u, 1u, NGF_IMAGE_FORMAT_RGBA8,
                                NGF_SAMPLE_COUNT_1, (uint32_t)(NGF_IMAGE_USAGE_ATTACHMENT | NGF_IMAGE_USAGE_XFER_SRC)};
  CHECK(ngf_create_image(&iinfo, &img));

  const ngf_attachment_description color_desc = {NGF_ATTACHMENT_COLOR, NGF_IMAGE_FORMAT_RGBA8, NGF_SAMPLE_COUNT_1, false};
  const ngf_attachment_descriptions descs = {&color_desc, 1u};
  const ngf_image_ref img_ref = {img, 0u, 0u, NGF_CUBEMAP_FACE_COUNT};
  ngf_render_target rt = NULL;
  const ngf_render_target_info rtinfo = {&descs, &img_ref};
  CHECK(ngf_create_render_target(&rtinfo, &rt));

  ngf_buffer vbuf = NULL;
  const ngf_buffer_info vinfo = {(size_t)nquads * 6 * 8 * sizeof(float), NGF_BUFFER_STORAGE_HOST_READABLE_WRITEABLE, NGF_BUFFER_USAGE_VERTEX_BUFFER};
  CHECK(ngf_create_buffer(&vinfo, &vbuf));
  const size_t vbytes = (size_t)nquads * 6 * 8 * sizeof(float);
  memcpy(ngf_buffer_map_range(vbuf, 0, vbytes), VERTS, vbytes);
  ngf_buffer_flush_range(vbuf, 0, vbytes);
  ngf_buffer_unmap(vbuf);

  const size_t pixels = (size_t)W * H * 4;
  ngf_buffer rbuf = NULL;
  const ngf_buffer_info rinfo = {(size_t)pixels, NGF_BUFFER_STORAGE_HOST_READABLE_WRITEABLE, NGF_BUFFER_USAGE_XFER_DST};
  CHECK(ngf_create_buffer(&rinfo, &rbuf));

  ngf_shader_stage vs = NULL, fs = NULL;
  const ngf_shader_stage_info vs_info = {NGF_STAGE_VERTEX, VS, (uint32_t)strlen(VS), "quad-vs", "vmain"};
  const ngf_shader_stage_info fs_info = {NGF_STAGE_FRAGMENT, FS, (uint32_t)strlen(FS), "quad-fs", "fmain"};
  CHECK(ngf_create_shader_stage(&vs_info, &vs));
  CHECK(ngf_create_shader_stage(&fs_info, &fs));

  ngf_util_graphics_pipeline_data pdata;
  ngf_util_create_default_graphics_pipeline_data(&pdata);
  pdata.rasterization_info.cull_mode = NGF_CULL_MODE_NONE;  // 2D: no winding, no back faces
  pdata.pipeline_info.nshader_stages = 2u;
  pdata.pipeline_info.shader_stages[0] = vs;
  pdata.pipeline_info.shader_stages[1] = fs;
  pdata.pipeline_info.compatible_rt_attachment_descs = &descs;
  ngf_graphics_pipeline pipe = NULL;
  CHECK(ngf_create_graphics_pipeline(&pdata.pipeline_info, &pipe));

  ngf_cmd_buffer cmdbuf = NULL;
  const ngf_cmd_buffer_info cbinfo = {0};
  CHECK(ngf_create_cmd_buffer(&cbinfo, &cmdbuf));

  const ngf_irect2d vp = {0, 0, W, H};
  const ngf_extent3d extent = {W, H, 1u};
  const ngf_offset3d zero = {0, 0, 0};

  // One frame: one render pass, the clear, the pipeline, the buffer, the draw. The image stays on the GPU.
  #define DRAW()                                                                                                   \
    do {                                                                                                           \
      ngf_start_cmd_buffer(cmdbuf, 0);                                                                             \
      ngf_render_encoder enc;                                                                               \
      ngf_cmd_begin_render_pass_simple(cmdbuf, rt, 16 / 255.0f, 18 / 255.0f, 24 / 255.0f, 1.0f, 0.0f, 0u, &enc);   \
      ngf_cmd_bind_gfx_pipeline(enc, pipe);                                                                        \
      ngf_cmd_viewport(enc, &vp);                                                                                  \
      ngf_cmd_scissor(enc, &vp);                                                                                   \
      ngf_cmd_bind_attrib_buffer(enc, vbuf, 0, 0);                                                                 \
      ngf_cmd_draw(enc, false, 0u, nquads * 6, 1u);                                                             \
      ngf_cmd_end_render_pass(enc);                                                                                \
      ngf_submit_cmd_buffers(1, &cmdbuf);                                                                          \
    } while (0)

  #define READBACK()                                                                                               \
    do {                                                                                                           \
      ngf_cmd_buffer xfer = NULL;                                                                                  \
      ngf_create_cmd_buffer(&cbinfo, &xfer);                                                                       \
      ngf_start_cmd_buffer(xfer, 0);                                                                               \
      ngf_xfer_encoder xenc;                                                                                       \
      const ngf_xfer_pass_info xpi = {NULL};                                                                       \
      ngf_cmd_begin_xfer_pass(xfer, &xpi, &xenc);                                                                  \
      ngf_cmd_copy_image_to_buffer(xenc, img_ref, zero, extent, 1u, rbuf, 0);                                      \
      ngf_cmd_end_xfer_pass(xenc);                                                                                 \
      ngf_submit_cmd_buffers(1, &xfer);                                                                            \
      ngf_finish();                                                                                                \
      (void)ngf_buffer_map_range(rbuf, 0, pixels);                                                                 \
      ngf_destroy_cmd_buffer(xfer);                                                                                \
    } while (0)

  DRAW();
  READBACK();  // the image holds the frame from here on; the bench phases below re-draw it each iteration

  if (bench > 0) {
    const int runs = 5;
    double a[5], e[5], b[5], c[5], d[5];
    for (int r = 0; r < runs; r++) {
      double t0 = now_ms();
      for (int i = 0; i < bench; i++) { DRAW(); }
      a[r] = (now_ms() - t0) / bench;  // record + submit, the CPU side of a frame
      ngf_finish();

      t0 = now_ms();
      for (int i = 0; i < bench; i++) { DRAW(); }
      ngf_finish();
      e[r] = (now_ms() - t0) / bench;  // the GPU's own throughput: N frames back to back, one wait at the end

      t0 = now_ms();
      for (int i = 0; i < bench; i++) { DRAW(); ngf_finish(); }
      b[r] = (now_ms() - t0) / bench;  // one frame and its wait: a round trip, still no readback

      t0 = now_ms();
      for (int i = 0; i < bench; i++) { READBACK(); }
      c[r] = (now_ms() - t0) / bench;  // the readback on its own

      t0 = now_ms();
      for (int i = 0; i < bench; i++) { DRAW(); READBACK(); }
      d[r] = (now_ms() - t0) / bench;  // a frame that comes back to the CPU
    }
    printf("quad: submit %.3f ms a frame (%d frames, median of %d)\n", median(a, runs), bench, runs);
    printf("quad: gpu %.3f ms a frame (no readback)\n", median(e, runs));
    printf("quad: gpu_sync %.3f ms a frame (draw and wait, no readback)\n", median(b, runs));
    printf("quad: readback %.3f ms a frame\n", median(c, runs));
    printf("quad: with_readback %.3f ms a frame\n", median(d, runs));
  }

  if (png) {
    const unsigned char *px = (const unsigned char *)ngf_buffer_map_range(rbuf, 0, pixels);
    write_png(png, px, W, H);
  }
  if (raw) {
    const unsigned char *px = (const unsigned char *)ngf_buffer_map_range(rbuf, 0, pixels);
    FILE *f = fopen(raw, "wb");
    if (f) { fwrite(px, 1, pixels, f); fclose(f); }
  }

  // Clean shutdown, so a leak check or a frame capture sees a tidy process.
  ngf_destroy_cmd_buffer(cmdbuf);
  ngf_destroy_buffer(rbuf);
  ngf_destroy_buffer(vbuf);
  ngf_destroy_render_target(rt);
  ngf_destroy_image(img);
  ngf_destroy_context(ctx);
  ngf_shutdown();
  return failures ? 1 : 0;
}
