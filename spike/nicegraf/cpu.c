// The CPU side of the comparison: the same two rectangles (the root fill and the Units pill) through ThorVG's
// software canvas, and the ms a frame. The frame with the page's real text and the border ring is
// `build/sensors/app --raster thorvg --bench`, which run.sh runs too: this is the rectangle-only number beside it.
//
//   cpu --bench 300
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <thorvg_capi.h>

#define W 360
#define H 360

typedef struct { float x, y, w, h, r; unsigned char cr, cg, cb; } rect;
static const rect RECTS[2] = {
    {0, 0, 360, 360, 0, 16, 18, 24},
    {80, 228.625f, 200, 38, 19, 36, 40, 52},
};
static rect QUADS[4098];
static int nquads = 2;

static int cmp_double(const void *a, const void *b) {
  double x = *(const double *)a, y = *(const double *)b;
  return (x > y) - (x < y);
}
static double median(double *v, int n) {
  qsort(v, (size_t)n, sizeof(double), cmp_double);
  return n % 2 ? v[n / 2] : 0.5 * (v[n / 2 - 1] + v[n / 2]);
}
static double now_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (double)ts.tv_sec * 1e3 + (double)ts.tv_nsec / 1e6;
}

int main(int argc, char **argv) {
  int bench = 300, grid = 0;
  for (int i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "--bench") && i + 1 < argc) bench = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--grid") && i + 1 < argc) grid = atoi(argv[++i]);
  }
  QUADS[0] = RECTS[0];
  QUADS[1] = RECTS[1];
  if (grid > 4096) grid = 4096;
  if (grid > 0) {
    int cols = 1;
    while (cols * cols < grid) cols++;
    const float cell = 360.0f / (float)cols;
    for (int i = 0; i < grid; i++) {
      QUADS[nquads++] = (rect){(float)(i % cols) * cell + 1, (float)(i / cols) * cell + 1, cell - 2, cell - 2, 0,
                               (unsigned char)(40 + (i * 37) % 200), (unsigned char)(30 + (i * 71) % 200),
                               (unsigned char)(60 + (i * 113) % 180)};
    }
  }
  if (tvg_engine_init(1) != TVG_RESULT_SUCCESS) { fprintf(stderr, "cpu: tvg_engine_init failed\n"); return 1; }
  uint32_t *pixels = calloc((size_t)W * H, 4);
  Tvg_Canvas canvas = tvg_swcanvas_create(TVG_ENGINE_OPTION_NONE);
  tvg_swcanvas_set_target(canvas, pixels, W, W, H, TVG_COLORSPACE_ABGR8888);
  tvg_canvas_set_viewport(canvas, 0, 0, W, H);

  // A frame is the paint tree built and drawn, as desktop/clay_renderer_thorvg.c builds one per Clay frame: a canvas
  // whose scene did not change is not drawn again (ThorVG keeps its surface), so a frame that rebuilds nothing costs
  // nothing and would lie.
  #define FRAME()                                                                                                  \
    do {                                                                                                           \
      Tvg_Paint root = tvg_scene_new();                                                                            \
      for (int i = 0; i < nquads; i++) {                                                                          \
        Tvg_Paint s = tvg_shape_new();                                                                             \
        tvg_shape_append_rect(s, QUADS[i].x, QUADS[i].y, QUADS[i].w, QUADS[i].h, QUADS[i].r, QUADS[i].r, true);     \
        tvg_shape_set_fill_color(s, QUADS[i].cr, QUADS[i].cg, QUADS[i].cb, 255);                                    \
        tvg_scene_add(root, s);                                                                                    \
      }                                                                                                            \
      tvg_canvas_add(canvas, root);                                                                                \
      tvg_canvas_draw(canvas, true);                                                                               \
      tvg_canvas_sync(canvas);                                                                                     \
      tvg_canvas_remove(canvas, root);                                                                             \
    } while (0)

  FRAME();
  double runs[5];
  for (int r = 0; r < 5; r++) {
    double t0 = now_ms();
    for (int i = 0; i < bench; i++) { FRAME(); }
    runs[r] = (now_ms() - t0) / bench;
  }
  printf("cpu: rects %.3f ms a frame (ThorVG software, %d quads, %d frames, median of 5)\n", median(runs, 5),
         nquads, bench);

  tvg_canvas_destroy(canvas);
  tvg_engine_term();
  free(pixels);
  return 0;
}
