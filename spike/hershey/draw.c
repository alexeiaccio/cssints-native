// The spike's drawing program: the same string three ways on ThorVG's software canvas — Hershey strokes at the face's
// own advances, the same strokes at Roboto's advances (the shape alone, without the metrics drift), and Roboto through
// the renderer's own text path (the same calls as desktop/clay_renderer_thorvg.c: a tvg_text paint, the size in points at
// 96 dpi, a translate). Standalone: no Clay, no SDL window — SDL is only the PNG writer host.c uses.
//
//   draw page  <size> <outdir> [ttf] [table]
//                                the spike's rows at one size: page-<size>-{hershey,hershey-adv,text}.png and the JSON
//                                the CoreText oracle and compare.mjs read (the same rows, places and crops)
//   draw bench [ttf] [table]     300 runs a frame at 14, 40 and 96 px, strokes and text: the median of 5 runs
//   draw atlas [ttf]             an A8 atlas of the 96 glyphs at 14, 40 and 96 px: the bytes a raster path would ship
//
// What the strokes cost: one shape a run, its sub-paths the glyphs' pen strokes, a round cap and a round join, the width
// 8% of the size (Roboto-Regular's stem is ~7.8% of the em). What the text costs: the renderer's text command, one paint
// a run. Both include the frame's scene building, tvg_canvas_draw and sync — the whole of what our renderer does for a
// frame of text — and nothing of Clay's layout. ThorVG keeps its own glyph cache, as it does in the renderer; the
// strokes are paths and are rasterised every frame, as they would be.
#include <limits.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <thorvg_capi.h>

#include <SDL3/SDL.h>
#include <SDL3_image/SDL_image.h>

// the sheet's page and ink, so the metric's coverage means the same thing as in solid/text.test.ts
#define BG_R 16
#define BG_G 18
#define BG_B 24
#define FG_R 235
#define FG_G 235
#define FG_B 240

// Roboto's cap height (OS/2 sCapHeight 1456 of 2048) and Hershey's, in its own 21-unit cap: a stroke font at "14 px" is
// the same optical size as the face it stands in for, so the cap is what is matched, not the em
#define ROBOTO_CAP 0.7109375f
#define HERSHEY_CAP 21.0f
// futural's baseline, in .jhf units (y grows down, caps -12..9)
#define HERSHEY_BASE 9.0f
// the monoline's weight: Roboto-Regular's stem, ~7.8% of the em, and 1 px at the smallest sizes
#define STROKE_OF_SIZE 0.078f

static const char *ROWS[] = {
    "Sensors",
    "Network & Sharing",
    "+1.16  -0.72  +10.04",
    "Room A1",
    "The quick brown fox",
    "switch to g",
    "gjpqy 0123456789",
    "settings",
    "0123456789", // the signage line the sheet has no room for
};
#define NROWS ((int)(sizeof ROWS / sizeof *ROWS))
#define MAXRUN 32

// --- the Hershey table (parse.mjs): "HSY1", u8 count, u8 first, 7 bytes a glyph (i8 left, i8 right, u8 strokes, u16
//     points, u16 offset into the body), then the body: per stroke a u8 point count and that many int8 (x, y)
typedef struct {
    int count, first, body;
    int left[128], right[128], strokes[128], offset[128];
    const uint8_t *bytes;
} HFont;

static int hf_load(const char *path, HFont *f)
{
    FILE *file = fopen(path, "rb");
    if (!file) return fprintf(stderr, "cannot read %s\n", path), 0;
    fseek(file, 0, SEEK_END);
    const long size = ftell(file);
    fseek(file, 0, SEEK_SET);
    uint8_t *bytes = malloc((size_t)size);
    if (!bytes || fread(bytes, 1, (size_t)size, file) != (size_t)size) return fclose(file), 0;
    fclose(file);
    if (size < 6 || memcmp(bytes, "HSY1", 4)) return fprintf(stderr, "%s is not an HSY1 table\n", path), 0;
    f->bytes = bytes;
    f->count = bytes[4], f->first = bytes[5];
    f->body = 6 + f->count * 7;
    for (int i = 0; i < f->count; i++) {
        const uint8_t *g = bytes + 6 + i * 7;
        f->left[i] = (int8_t)g[0], f->right[i] = (int8_t)g[1], f->strokes[i] = g[2];
        f->offset[i] = g[5] | g[6] << 8;
    }
    return 1;
}

static int hf_index(const HFont *f, char c)
{
    const int i = c - f->first;
    return i >= 0 && i < f->count ? i : 0; // anything the font has no glyph for is the space
}

/** A run's advance in px, as the .jhf's left/right give it: no kerning, as ThorVG's text has none. */
static float hf_width(const HFont *f, const char *s, float scale)
{
    float w = 0;
    for (; *s; s++) w += (f->right[hf_index(f, *s)] - f->left[hf_index(f, *s)]) * scale;
    return w;
}

/** One run as one stroked shape: every glyph's strokes in the shape's own path, the pen at the glyphs' own bearings.
 *  `penx` is where each glyph starts, or NULL for the .jhf's own advances. */
static Tvg_Paint hf_run(const HFont *f, const char *s, const float *penx, float x, float baseline, float scale,
                        float weight)
{
    Tvg_Paint shape = tvg_shape_new();
    float pen = x;
    for (int n = 0; *s; s++, n++) {
        const int gi = hf_index(f, *s);
        if (penx) pen = penx[n];
        int nstrokes = f->strokes[gi];
        const uint8_t *p = f->bytes + f->body + f->offset[gi];
        for (int k = 0; k < nstrokes; k++) {
            const int np = *p++;
            for (int i = 0; i < np; i++, p += 2) {
                const float gx = pen + ((float)(int8_t)p[0] - f->left[gi]) * scale;
                const float gy = baseline + ((float)(int8_t)p[1] - HERSHEY_BASE) * scale;
                if (i == 0) tvg_shape_move_to(shape, gx, gy);
                else tvg_shape_line_to(shape, gx, gy);
            }
        }
        if (!penx) pen += (f->right[gi] - f->left[gi]) * scale;
    }
    // the stroke alone: a fill of zero alpha, so the open sub-paths are never filled
    tvg_shape_set_fill_color(shape, 0, 0, 0, 0);
    tvg_shape_set_stroke_width(shape, weight);
    tvg_shape_set_stroke_color(shape, FG_R, FG_G, FG_B, 255);
    tvg_shape_set_stroke_cap(shape, TVG_STROKE_CAP_ROUND);
    tvg_shape_set_stroke_join(shape, TVG_STROKE_JOIN_ROUND);
    return shape;
}

/** Where Roboto puts each glyph of a run, from `x`: the shape-only comparison, which takes the metrics drift out. */
static void ttf_penx(const char *font, const char *s, float px, float x, float *out)
{
    Tvg_Paint t = tvg_text_new();
    tvg_text_set_font(t, font);
    tvg_text_set_size(t, px * 0.75f);
    float pen = x;
    for (int n = 0; *s; s++, n++) {
        char one[2] = {*s, 0};
        tvg_text_set_text(t, one);
        Tvg_Glyph_Metrics g;
        const char *p = one;
        out[n] = pen;
        if (tvg_text_get_glyph_metrics(t, p, &g, &p) == TVG_RESULT_SUCCESS) pen += g.advance;
    }
}

/** One run as the renderer draws text: the font by name, the size in points at 96 dpi, the box's top-left. */
static Tvg_Paint ttf_run(const char *font, const char *s, float px, float x, float y)
{
    Tvg_Paint text = tvg_text_new();
    tvg_text_set_font(text, font);
    tvg_text_set_size(text, px * 0.75f);
    tvg_text_set_text(text, s);
    tvg_text_set_color(text, FG_R, FG_G, FG_B);
    tvg_paint_translate(text, x, y);
    return text;
}

/** Roboto's line ascent at a size, in px: ThorVG's own, which is where the baseline of a text command is (measured:
 *  "Sensors" at 32 px puts its baseline 29.69 px under the box's top). The CoreText oracle assumes the same. */
static float ttf_ascent(const char *font, float px)
{
    Tvg_Paint t = tvg_text_new();
    tvg_text_set_font(t, font);
    tvg_text_set_size(t, px * 0.75f);
    tvg_text_set_text(t, "H");
    Tvg_Text_Metrics m = {0};
    tvg_text_get_text_metrics(t, &m);
    tvg_paint_rel(t);
    return m.ascent;
}

/** A run's advance as ThorVG measures it: the sum of the glyphs' advances, as Clay_ThorVG_MeasureText sums them. */
static float ttf_width(const char *font, const char *s, float px)
{
    Tvg_Paint t = tvg_text_new();
    tvg_text_set_font(t, font);
    tvg_text_set_size(t, px * 0.75f);
    tvg_text_set_text(t, s);
    float w = 0;
    for (const char *p = s; *p;) {
        Tvg_Glyph_Metrics g;
        if (tvg_text_get_glyph_metrics(t, p, &g, &p) != TVG_RESULT_SUCCESS) break;
        w += g.advance;
    }
    tvg_paint_rel(t);
    return w;
}

// --- the canvas: one software canvas, its target, and a scene a frame
typedef struct {
    Tvg_Canvas canvas;
    uint32_t *pixels;
    int width, height;
} Screen;

static int screen_new(Screen *s, int width, int height)
{
    s->width = width, s->height = height;
    s->pixels = calloc((size_t)width * height, 4);
    if (!s->pixels) return 0;
    s->canvas = tvg_swcanvas_create(TVG_ENGINE_OPTION_DEFAULT);
    if (!s->canvas) return 0;
    return tvg_swcanvas_set_target(s->canvas, s->pixels, (uint32_t)width, (uint32_t)width, (uint32_t)height,
                                   TVG_COLORSPACE_ABGR8888) == TVG_RESULT_SUCCESS;
}

/** Draws one scene, over the target or clearing it, and releases the paint: the canvas's remove is what frees it (a
 *  tvg_paint_rel after it is a double free, measured). */
static int screen_draw(Screen *s, Tvg_Paint root, int clear)
{
    tvg_canvas_remove(s->canvas, NULL);
    tvg_canvas_add(s->canvas, root);
    const Tvg_Result drawn = tvg_canvas_draw(s->canvas, clear);
    const Tvg_Result synced = tvg_canvas_sync(s->canvas);
    tvg_canvas_remove(s->canvas, root);
    return drawn == TVG_RESULT_SUCCESS && synced == TVG_RESULT_SUCCESS;
}

/** The page as a PNG (SDL's writer, as host.c's): the buffer is the surface's, RGBA32 in memory. */
static int save_png(const Screen *s, const char *path)
{
    SDL_Surface *surface = SDL_CreateSurfaceFrom(s->width, s->height, SDL_PIXELFORMAT_RGBA32, s->pixels, s->width * 4);
    if (!surface) return 0;
    const int ok = IMG_SavePNG(surface, path) != 0; // SDL3_image's bool: true is written
    SDL_DestroySurface(surface);
    return ok;
}

/** The page's colour, under the draw: the canvas clears to transparent, and this is the page the text is on. */
static void fill_page(Screen *s)
{
    for (int i = 0; i < s->width * s->height; i++)
        s->pixels[i] = (uint32_t)BG_R | (uint32_t)BG_G << 8 | (uint32_t)BG_B << 16 | 0xff000000u;
}

// --- the page: the rows at one size, laid out once so every raster (strokes, text, CoreText) agrees to the pixel
typedef struct {
    int size;
    int width, height;
    int margin;
    int rowH;
    float ascent;
    float hershey; // px a .jhf unit
    float weight;  // px of the stroke
} Page;

static void page_layout(Page *p, int size, const char *font, const HFont *hf)
{
    memset(p, 0, sizeof *p);
    p->size = size;
    p->margin = 24;
    p->rowH = (int)lroundf(size * 1.7f);
    p->ascent = ttf_ascent(font, (float)size);
    p->hershey = ROBOTO_CAP * size / HERSHEY_CAP;
    p->weight = size * STROKE_OF_SIZE < 1 ? 1 : size * STROKE_OF_SIZE;
    float widest = 0;
    for (int i = 0; i < NROWS; i++) {
        const float a = ttf_width(font, ROWS[i], (float)size), b = hf_width(hf, ROWS[i], p->hershey);
        if (a > widest) widest = a;
        if (b > widest) widest = b;
    }
    p->width = p->margin * 2 + (int)ceilf(widest);
    p->height = p->margin * 2 + NROWS * p->rowH;
}

/** The page's rows as one scene: 0 the TTF text, 1 the strokes at the face's advances, 2 the strokes at Roboto's. */
static Tvg_Paint page_scene(const Page *p, const char *font, const HFont *hf, int mode)
{
    Tvg_Paint root = tvg_scene_new();
    for (int i = 0; i < NROWS; i++) {
        const float x = p->margin, top = p->margin + i * p->rowH;
        if (mode == 0) {
            tvg_scene_add(root, ttf_run(font, ROWS[i], (float)p->size, x, top));
            continue;
        }
        float penx[MAXRUN];
        const float *advances = NULL;
        if (mode == 2) {
            ttf_penx(font, ROWS[i], (float)p->size, x, penx);
            advances = penx;
        }
        tvg_scene_add(root, hf_run(hf, ROWS[i], advances, x, top + p->ascent, p->hershey, p->weight));
    }
    return root;
}

/** The JSON the oracle and the metric read: the oracle's spec (its own keys, the rest ignored) and the crops. */
static int write_page_json(const Page *p, const char *out, const char *dir, const char *fontPath)
{
    FILE *f = fopen(out, "w");
    if (!f) return 0;
    fprintf(f, "{\"width\":%d,\"height\":%d,\"bg\":[%d,%d,%d],\"fg\":[%d,%d,%d],\n", p->width, p->height, BG_R, BG_G,
            BG_B, FG_R, FG_G, FG_B);
    fprintf(f, "\"font\":\"%s\",\"out\":\"%s/page-%d-oracle.png\",\n", fontPath, dir, p->size);
    fprintf(f, "\"rows\":[");
    for (int i = 0; i < NROWS; i++)
        fprintf(f, "%s{\"text\":\"%s\",\"size\":%d,\"x\":%d,\"y\":%d}", i ? ",\n  " : "\n  ", ROWS[i], p->size,
                p->margin, p->margin + i * p->rowH);
    // a crop is a row's box, drawn a little out on every side so nothing the rasters disagree about the extent of is cut
    fprintf(f, "\n],\n\"crops\":[");
    for (int i = 0; i < NROWS; i++)
        fprintf(f, "%s{\"id\":\"%d-%d\",\"text\":\"%s\",\"size\":%d,\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d}",
                i ? ",\n  " : "\n  ", p->size, i, ROWS[i], p->size, p->margin - 8, p->margin + i * p->rowH - 6,
                p->width - 2 * p->margin + 16, p->rowH);
    fprintf(f, "\n]}\n");
    return fclose(f) == 0;
}

static int cmd_page(int size, const char *dir, const char *font, const char *fontPath, const char *table)
{
    HFont hf;
    if (!hf_load(table, &hf)) return 1;
    Page p;
    page_layout(&p, size, font, &hf);
    const char *names[3] = {"text", "hershey", "hershey-adv"}; // page_scene: 0 the TTF, 1 the face's advances, 2 Roboto's
    for (int mode = 0; mode < 3; mode++) {
        // a canvas an image: a canvas's second draw onto a target it has already drawn writes a shape's own alpha over
        // the page (an alpha-0 fill turns its area transparent), so a reused canvas corrupts the page under the strokes
        Screen s;
        if (!screen_new(&s, p.width, p.height)) return fprintf(stderr, "no canvas\n"), 1;
        char path[4096];
        snprintf(path, sizeof path, "%s/page-%d-%s.png", dir, size, names[mode]);
        fill_page(&s);
        if (!screen_draw(&s, page_scene(&p, font, &hf, mode), 0) || !save_png(&s, path))
            return fprintf(stderr, "the %s page: %s\n", names[mode], path), 1;
        tvg_canvas_destroy(s.canvas);
        free(s.pixels);
    }
    // the JSON's font and out are absolute: the oracle runs from wherever it is called
    char absFont[PATH_MAX], absDir[PATH_MAX], path[4096];
    if (!realpath(fontPath, absFont) || !realpath(dir, absDir)) return fprintf(stderr, "no such path\n"), 1;
    snprintf(path, sizeof path, "%s/page-%d.json", dir, size);
    if (!write_page_json(&p, path, absDir, absFont)) return fprintf(stderr, "cannot write %s\n", path), 1;
    printf("page %d: %dx%d, %d rows of %d px, ascent %.2f, hershey %.4f px a unit (cap %.1f px), stroke %.2f px\n", size,
           p.width, p.height, NROWS, p.rowH, p.ascent, p.hershey, HERSHEY_CAP * p.hershey, p.weight);
    return 0;
}

// --- the bench: 300 runs a frame — four columns of 75, on a page as wide as the widest run, so none is clipped — at
//     each size
static int cmp_u64(const void *a, const void *b)
{
    const uint64_t x = *(const uint64_t *)a, y = *(const uint64_t *)b;
    return x < y ? -1 : x > y;
}

#define RUNS 300
#define REPS 5

static int cmd_bench(const char *font, const char *table)
{
    HFont hf;
    if (!hf_load(table, &hf)) return 1;
    const int sizes[] = {14, 40, 96};
    // the frames a number is the median of: the small size is cheap, a 96 px page of 300 runs is 36 megapixels of buffer
    // to clear and a minute's worth of ink
    const int frames[] = {200, 100, 20};
    printf("bench: %d runs a frame, median of %d runs, page clear + scene build + draw + sync\n", RUNS, REPS);
    for (int k = 0; k < 3; k++) {
        const int size = sizes[k], count = frames[k];
        Page p;
        page_layout(&p, size, font, &hf);
        float widest = 0;
        for (int i = 0; i < NROWS; i++) {
            const float a = ttf_width(font, ROWS[i], (float)size), b = hf_width(&hf, ROWS[i], p.hershey);
            if (a > widest) widest = a;
            if (b > widest) widest = b;
        }
        const int cols = 4;
        const int rows = (RUNS + cols - 1) / cols;
        const int width = (int)ceilf(widest) + 16;
        const int height = rows * p.rowH + 8;
        Screen s;
        if (!screen_new(&s, width, height)) return fprintf(stderr, "no canvas\n"), 1;
        const float ascent = p.ascent, scale = p.hershey, weight = p.weight;
        // the runs' places, the same for both modes: four columns, the rows as they come
        int rx[RUNS], ry[RUNS], rr[RUNS];
        for (int i = 0; i < RUNS; i++) {
            rx[i] = 8 + (i % cols) * (width / cols);
            ry[i] = 8 + (i / cols) * p.rowH;
            rr[i] = i % NROWS;
        }
        // 0: the empty page, 1: the strokes, 2: the text, 3: the strokes' path and fill with no stroke (so the stroke's
        // own raster can be told from the geometry it is a stroke of)
        uint64_t us[4][REPS] = {{0}};
        for (int mode = 0; mode < 4; mode++) {
            for (int rep = 0; rep < REPS; rep++) {
                const uint64_t t0 = SDL_GetTicksNS();
                for (int f = 0; f < count; f++) {
                    Tvg_Paint root = tvg_scene_new();
                    if (mode)
                        for (int i = 0; i < RUNS; i++)
                            tvg_scene_add(root, mode == 2
                                                    ? ttf_run(font, ROWS[rr[i]], (float)size, (float)rx[i], (float)ry[i])
                                                    : hf_run(&hf, ROWS[rr[i]], NULL, (float)rx[i], ry[i] + ascent, scale,
                                                             mode == 1 ? weight : 0));
                    if (!screen_draw(&s, root, 1)) return fprintf(stderr, "draw failed\n"), 1;
                }
                us[mode][rep] = (SDL_GetTicksNS() - t0) / 1000 / (uint64_t)count; // µs a frame
            }
        }
        for (int mode = 0; mode < 4; mode++) qsort(us[mode], REPS, sizeof(uint64_t), cmp_u64);
        const uint64_t empty = us[0][REPS / 2], strokes = us[1][REPS / 2], text = us[2][REPS / 2];
        const uint64_t path = us[3][REPS / 2];
        printf("bench %d: page %dx%d, %d frames x %d, empty %.3f ms/frame, strokes %.3f ms/frame (%.1f us a run), "
               "text %.3f ms/frame (%.1f us a run), the path and fill alone %.3f ms/frame\n",
               size, width, height, count, REPS, empty / 1000.0, strokes / 1000.0, strokes / 1000.0 * 1000 / RUNS,
               text / 1000.0, text / 1000.0 * 1000 / RUNS, path / 1000.0);
        printf("bench %d: over the empty page: strokes %.3f ms, text %.3f ms (strokes %.2fx the text)\n", size,
               (strokes - empty) / 1000.0, (text - empty) / 1000.0, (double)strokes / (double)text);
        free(s.pixels);
    }
    return 0;
}

// --- the atlas: what a raster path ships — every glyph's coverage at each size, in one A8 sheet a size
#define ATLAS_W 256 // a texture's width: 96 glyphs of a size, packed in shelves, a pixel between them
#define ATLAS_H 8192

static int cmd_atlas(const char *font)
{
    const int sizes[] = {14, 40, 96};
    printf("atlas: the 96 glyphs of the font, an A8 sheet a size, tight glyph boxes packed in shelves %d px wide\n",
           ATLAS_W);
    int total = 0, areaTotal = 0;
    for (int k = 0; k < 3; k++) {
        const int size = sizes[k];
        const int side = size * 4;
        uint8_t *sheet = calloc(ATLAS_W * ATLAS_H, 1);
        int x = 1, y = 1, shelf = 0, area = 0;
        for (int gi = 0; gi < 96; gi++) {
            char ch[2] = {(char)(32 + gi), 0};
            // a canvas a glyph: a canvas's second draw writes a paint's own alpha over the target (measured), and this
            // cell wants the glyph on black and nothing else
            Screen cell;
            if (!screen_new(&cell, side, side)) return 1;
            for (int i = 0; i < side * side; i++) cell.pixels[i] = 0xff000000u;
            // one glyph through ThorVG's text path into the cell, its own bearing from the origin
            Tvg_Paint root = tvg_scene_new();
            Tvg_Paint t = tvg_text_new();
            tvg_text_set_font(t, font);
            tvg_text_set_size(t, size * 0.75f);
            tvg_text_set_text(t, ch);
            tvg_text_set_color(t, 255, 255, 255);
            tvg_paint_translate(t, (float)size, (float)size * 2);
            tvg_scene_add(root, t);
            if (!screen_draw(&cell, root, 0)) return 1;
            int x0 = side, y0 = side, x1 = -1, y1 = -1;
            for (int py = 0; py < side; py++)
                for (int px = 0; px < side; px++) {
                    if ((cell.pixels[py * side + px] & 0xffffff) == 0) continue; // the cell's black: nothing drawn
                    if (px < x0) x0 = px;
                    if (py < y0) y0 = py;
                    if (px > x1) x1 = px;
                    if (py > y1) y1 = py;
                }
            if (x1 < 0) x0 = y0 = x1 = y1 = 0;
            const int w = x1 - x0 + 1, h = y1 - y0 + 1;
            area += w * h;
            if (x + w + 1 >= ATLAS_W) x = 1, y += shelf + 1, shelf = 0;
            // the sheet's pixels: the cell's coverage (its red channel, white on black), packed with a pixel between
            for (int py = 0; py < h; py++)
                for (int px = 0; px < w; px++)
                    sheet[(y + py) * ATLAS_W + x + px] = (uint8_t)(cell.pixels[(y0 + py) * side + x0 + px] & 0xff);
            x += w + 1;
            if (h > shelf) shelf = h;
            tvg_canvas_destroy(cell.canvas);
            free(cell.pixels);
        }
        const int sheetH = y + shelf + 1;
        total += ATLAS_W * sheetH;
        areaTotal += area;
        char path[1024];
        snprintf(path, sizeof path, "out/atlas-%d.a8", size);
        FILE *f = fopen(path, "wb");
        if (!f) return 1;
        for (int py = 0; py < sheetH; py++) fwrite(sheet + py * ATLAS_W, 1, ATLAS_W, f);
        fclose(f);
        // 14 bytes a glyph of index: x, y, w, h, bearing x, bearing y, advance
        printf("atlas %d: %dx%d, %d bytes of coverage (the glyph boxes alone %d), %d bytes of index\n", size, ATLAS_W,
               sheetH, ATLAS_W * sheetH, area, 96 * 14);
        free(sheet);
    }
    printf("atlas: %d bytes of coverage at 14, 40 and 96 px (%d of glyph boxes), the index %d\n", total, areaTotal,
           96 * 14 * 3);
    return 0;
}

int main(int argc, char **argv)
{
    const char *font = "../../vendor/fonts/Roboto-Regular.ttf";
    const char *table = "out/futural.bin";
    const char *mode = argc > 1 ? argv[1] : "";
    char name[256];
    snprintf(name, sizeof name, "%s", strrchr(font, '/') ? strrchr(font, '/') + 1 : font);
    name[strlen(name) - 4] = 0; // "Roboto-Regular.ttf" -> the name tvg_font_load registers
    if (!strcmp(mode, "page")) {
        if (argc < 4) return fprintf(stderr, "usage: draw page <size> <outdir> [ttf] [table]\n"), 2;
        if (argc > 4) font = argv[4];
        if (argc > 5) table = argv[5];
        snprintf(name, sizeof name, "%s", strrchr(font, '/') ? strrchr(font, '/') + 1 : font);
        name[strlen(name) - 4] = 0;
        tvg_engine_init(0);
        if (tvg_font_load(font) != TVG_RESULT_SUCCESS) return fprintf(stderr, "no font %s\n", font), 1;
        return cmd_page(atoi(argv[2]), argv[3], name, font, table);
    }
    if (!strcmp(mode, "bench") || !strcmp(mode, "atlas")) {
        if (argc > 2) font = argv[2];
        if (argc > 3) table = argv[3];
        snprintf(name, sizeof name, "%s", strrchr(font, '/') ? strrchr(font, '/') + 1 : font);
        name[strlen(name) - 4] = 0;
        tvg_engine_init(0);
        if (tvg_font_load(font) != TVG_RESULT_SUCCESS) return fprintf(stderr, "no font %s\n", font), 1;
        return !strcmp(mode, "bench") ? cmd_bench(name, table) : cmd_atlas(name);
    }
    return fprintf(stderr, "usage: draw page <size> <outdir> [ttf] [table] | draw bench [ttf] [table] | draw atlas [ttf]\n"),
           2;
}
