// Clay's render commands on ThorVG's software canvas: each frame is a new scene of shapes and texts, drawn into a
// 32-bit buffer (ABGR8888: R,G,B,A bytes in memory, as SDL's RGBA32). Text is measured with ThorVG too, so what Clay
// lays out is what is drawn: the width is the sum of glyph advances (ThorVG 1.1 applies no kerning), the height the
// font's line advance.
#include <math.h>
#include <thorvg_capi.h>

// The frame's element tree and its groups. A group is one element's subtree drawn into a ThorVG scene of its own, so a
// scene effect (opacity) and a scene transform (scale and translate) reach everything in it — a text over its own fill,
// an image, a gradient — which per-command alpha cannot. Clay's commands are in depth-first tree order, so a subtree's
// commands are contiguous and a group is the range [first, last] of them.
// ponytail: 1024 elements and 16 groups a frame, four groups open at once (a group in a group in ...); past that the
// tree counts an error and a fifth open group is drawn ungrouped. A page bigger than the tree needs a table that grows.
#define CLAY_THORVG_MAX_TREE 1024
#define CLAY_THORVG_MAX_DEPTH 64
#define CLAY_THORVG_MAX_GROUPS 16
#define CLAY_THORVG_MAX_NESTING 4
#define CLAY_THORVG_MAX_SCISSORS 8

// Where a gradient was drawn, in device pixels, for the dither after the draw: the box mapped by the groups around it
// and cut to the canvas and the clips, so the stipple lands on the gradient's own pixels only. A turned map (`turn`)
// marks the quad instead: the pixel's own point, mapped back into the shape's space, against the box and its corner arcs
// there.
typedef struct {
    int x0, y0, x1, y1;
    float cx[4], cy[4], r[4]; // each corner's arc: centre and radius (0 for a square corner)
    bool turn;
    float uxx, uxy, utx; // a device pixel back into the shape's own units: u = uxx·x + uxy·y + utx
    float uyx, uyy, uty; // ... and v = uyx·x + uyy·y + uty
    float bx0, by0, bx1, by1; // the box in the shape's own units ...
    float kcx[4], kcy[4], kr[4]; // ... and its corner arcs there
    // the clips open when it was drawn that the scene had turned: the mark must be inside each of their quads, not just
    // the boxes of them (a pixel the clip cut away is the page, and is not stippled)
    int cutCount;
    float cutX[CLAY_THORVG_MAX_SCISSORS][4], cutY[CLAY_THORVG_MAX_SCISSORS][4];
    bool on;
} Clay_ThorVG_GradientArea;

typedef struct {
    Tvg_Canvas canvas;
    float scale;        // device pixels per Clay unit (the window's pixel density); the buffer is that much larger
    const char **fonts; // ThorVG font names by fontId (tvg_font_load names a font by its file name, no extension)
    Tvg_Paint measurer; // a text paint for Clay_ThorVG_MeasureText
    bool clear;         // draw into a target whose last frame is gone (a swapchain): clear it, not just overdraw it
    // a text weight in Clay units: a line drawn twice, half the weight either side of where Clay put it, grows every
    // stroke by that much and keeps the line's centre (0, the default: one copy). The text oracle measures it
    // (solid/text.test.ts): ThorVG's raster already weighs what CoreText weighs, 1.008 of it, so the dial is at 0 and a
    // weight would be a regression — it is here because that is a measurement, not an assumption
    float textWeight;
    // an image's picture, by the imageData it was loaded from: a cssints/clay image carries the path in that pointer
    struct {
        const void *imageData;
        Tvg_Paint picture;
    } images[32];
    int imageCount;
    // the frame's shadows (css.shadow), by the id of the element that casts one: no Clay field holds a shadow, so the
    // host sets them beside the declaration and the command stream's id finds them again here
    struct {
        uint32_t id; // Clay_ElementId.id of the element
        float x, y, blur;
        Clay_Color color;
        bool drawn;
    } shadows[32];
    int shadowCount;
    // the frame's backdrops (css.backdrop), by the id of the element that has one: the same ride-along as a shadow, but
    // the effect is on the pixels already in the target, not on a scene
    struct {
        uint32_t id;
        float blur;
    } backdrops[8];
    int backdropCount;
    // the frame's gradients (css.backgroundImage), by the id of the element that has one: the element's box is filled with
    // the linear gradient instead of its solid background. A table beside the commands, as the shadows are.
    struct {
        uint32_t id;
        int kind; // 1: linear
        float angle;
        int count;
        float offset[8];
        Clay_Color color[8];
        int alpha; // 255: the gradient alone, as an opaque one; below it, composited over the box's solid fill
        bool drawn;
        Clay_ThorVG_GradientArea area;
    } gradients[16];
    int gradientCount;
    // the frame's element tree (ui_open/ui_close and ui_text), in declaration order: a node's id and the index of the
    // element it was declared in (-1 at the root). Every command carries its node as `userData` (index + 1), so a
    // subtree becomes the range of command indices whose node is that element or a descendant. `open` is the elements
    // still open (a text is a node but is never open: Clay adds it to its parent and it holds no children).
    struct {
        uint32_t id;
        int32_t parent;
    } tree[CLAY_THORVG_MAX_TREE];
    int treeCount;
    int32_t open[CLAY_THORVG_MAX_DEPTH];
    int openDepth;
    // the frame's groups (the value channel's ALPHA, SCALE, TRANSLATE_X/Y and ROTATE), one per element that has one: a
    // scene around the element's whole subtree, composited at the alpha (tvg_paint_set_opacity, 0..255), scaled about the
    // centre of the element's box on the first command of the range, rotated about the same centre and moved by the
    // translate (tvg_paint_set_transform: no layout, `ui_bounds` does not move)
    struct {
        int32_t at;   // the element's index in the tree
        int alpha;    // 0..255; 255 is nothing, and no scene is made
        float scale;  // 1 is nothing
        float tx;     // a visual offset of the subtree, px; 0 is nothing
        float ty;
        float rotate; // degrees about the box centre; 0 is nothing
    } groups[CLAY_THORVG_MAX_GROUPS];
    int groupCount;
    bool cut; // this frame's one cut has happened (the first backdrop's first rectangle)
    // the software canvas's target, for the CPU blur of a backdrop: the WebGPU canvas reads its frame back only after
    // the whole draw, so it sets none and a backdrop is not blurred there (the frame is not cut either)
    uint32_t *target;
    int targetWidth, targetHeight;
} Clay_ThorVGRendererData;

// CSS sizes a box-shadow's blur as twice the gaussian's standard deviation; ThorVG takes sigma, in the scene's own
// units (measured: the same sigma through a root scene at scale 2 blurs twice as many device pixels)
#define CLAY_THORVG_SHADOW_SIGMA(blur) ((blur) / 2.0f)
// the effect's steps: 80 is smooth at a 24px edge and costs one pass a shadow
#define CLAY_THORVG_SHADOW_QUALITY 80

#define CLAY_THORVG_PI 3.14159265358979323846f

// Clay sizes are CSS pixels; ThorVG sizes text in points at 96 dpi
#define CLAY_THORVG_PT 0.75f

static const char *Clay_ThorVG_CString(Clay_StringSlice s)
{
    // ponytail: one static buffer, text longer than it is cut; grow it when a page needs longer runs
    static char buf[1024];
    const int n = s.length < (int)sizeof buf - 1 ? s.length : (int)sizeof buf - 1;
    memcpy(buf, s.chars, n);
    buf[n] = 0;
    return buf;
}

/** One paint of a text command: its font, size, string and colour, at x, y. The caller adds it to a scene. */
static Tvg_Paint Clay_ThorVG_TextPaint(Clay_ThorVGRendererData *d, const Clay_TextRenderData *r, float x, float y)
{
    Tvg_Paint t = tvg_text_new();
    tvg_text_set_font(t, d->fonts[r->fontId]);
    tvg_text_set_size(t, r->fontSize * CLAY_THORVG_PT);
    tvg_text_set_text(t, Clay_ThorVG_CString(r->stringContents));
    tvg_text_set_color(t, r->textColor.r, r->textColor.g, r->textColor.b);
    tvg_paint_set_opacity(t, r->textColor.a);
    tvg_paint_translate(t, x, y);
    return t;
}

static Clay_Dimensions Clay_ThorVG_MeasureText(Clay_StringSlice text, Clay_TextElementConfig *config, void *user)
{
    Clay_ThorVGRendererData *d = user;
    Tvg_Paint t = d->measurer;
    tvg_text_set_font(t, d->fonts[config->fontId]);
    tvg_text_set_size(t, (config->fontSize ? config->fontSize : 14) * CLAY_THORVG_PT);
    float w = 0;
    for (const char *p = Clay_ThorVG_CString(text); *p;) {
        Tvg_Glyph_Metrics g;
        if (tvg_text_get_glyph_metrics(t, p, &g, &p) != TVG_RESULT_SUCCESS) break;
        w += g.advance + config->letterSpacing;
    }
    Tvg_Text_Metrics m = {0};
    tvg_text_get_text_metrics(t, &m);
    return (Clay_Dimensions){w, config->lineHeight ? (float)config->lineHeight : m.advance};
}

/** Appends a rounded rect with elliptic corners: rx/ry per corner (tl, tr, br, bl), clamped to half the box. */
static void Clay_ThorVG_RoundRect(Tvg_Paint s, float x, float y, float w, float h, const float rx[4], const float ry[4])
{
    const float k = 1 - 0.5522848f, mx = w / 2, my = h / 2;
    float a[4], b[4];
    for (int i = 0; i < 4; i++) a[i] = rx[i] < mx ? rx[i] : mx, b[i] = ry[i] < my ? ry[i] : my;
    for (int i = 0; i < 4; i++) a[i] = a[i] > 0 ? a[i] : 0, b[i] = b[i] > 0 ? b[i] : 0;
    tvg_shape_move_to(s, x + a[0], y);
    tvg_shape_line_to(s, x + w - a[1], y);
    tvg_shape_cubic_to(s, x + w - a[1] * k, y, x + w, y + b[1] * k, x + w, y + b[1]);
    tvg_shape_line_to(s, x + w, y + h - b[2]);
    tvg_shape_cubic_to(s, x + w, y + h - b[2] * k, x + w - a[2] * k, y + h, x + w - a[2], y + h);
    tvg_shape_line_to(s, x + a[3], y + h);
    tvg_shape_cubic_to(s, x + a[3] * k, y + h, x, y + h - b[3] * k, x, y + h - b[3]);
    tvg_shape_line_to(s, x, y + b[0]);
    tvg_shape_cubic_to(s, x, y + b[0] * k, x + a[0] * k, y, x + a[0], y);
    tvg_shape_close(s);
}

/** The picture of an image path, loaded on first use and kept: the path is the imageData of the command, and the
 *  style's own string is the key, so two elements of one style share one picture. NULL if the file does not load. */
static Tvg_Paint Clay_ThorVG_Picture(Clay_ThorVGRendererData *d, const void *imageData)
{
    const char *path = imageData;
    if (!path) return NULL;
    for (int i = 0; i < d->imageCount; i++)
        if (d->images[i].imageData == imageData) return d->images[i].picture;
    // ponytail: 32 images, no eviction; a scene past that needs a list that grows
    if (d->imageCount == (int)(sizeof d->images / sizeof *d->images)) return NULL;
    Tvg_Paint p = tvg_picture_new();
    if (tvg_picture_load(p, path) != TVG_RESULT_SUCCESS) {
        fprintf(stderr, "image not loaded: %s\n", path);
        tvg_paint_rel(p);
        p = NULL;
    }
    d->images[d->imageCount].imageData = imageData;
    d->images[d->imageCount++].picture = p;
    return p;
}

/** Gives the element with this id's hash a shadow for the next draw (one a frame). It is a renderer effect, not a Clay
 *  declaration: `css.shadow` is carried beside the packed box, and the command stream's id is what finds it again. */
static void Clay_ThorVG_SetShadow(Clay_ThorVGRendererData *d, uint32_t id, float x, float y, float blur, Clay_Color color)
{
    // ponytail: 32 shadows a frame, one an element, no spread and no inner shadow (the box is the element's own); more
    // needs a table that grows and a second kind of shape
    if (d->shadowCount == (int)(sizeof d->shadows / sizeof *d->shadows)) return;
    d->shadows[d->shadowCount].id = id;
    d->shadows[d->shadowCount].x = x;
    d->shadows[d->shadowCount].y = y;
    d->shadows[d->shadowCount].blur = blur;
    d->shadows[d->shadowCount].color = color;
    d->shadows[d->shadowCount].drawn = false;
    d->shadowCount++;
}

/** Draws the shadow of the element a command belongs to, once and before the command itself: the command's box moved by
 *  the shadow's offset, filled with its colour, blurred as a scene effect. A rectangle or a border brings its corner
 *  radii; a text or an image box is square. */
static void Clay_ThorVG_DrawShadow(Clay_ThorVGRendererData *d, Clay_RenderCommand *rcmd, Tvg_Paint into)
{
    for (int i = 0; i < d->shadowCount; i++) {
        if (d->shadows[i].id != rcmd->id || d->shadows[i].drawn) continue;
        d->shadows[i].drawn = true;
        const float blur = d->shadows[i].blur;
        const float x = (int)rcmd->boundingBox.x + d->shadows[i].x;
        const float y = (int)rcmd->boundingBox.y + d->shadows[i].y;
        const float w = (int)rcmd->boundingBox.width, h = (int)rcmd->boundingBox.height;
        float rad[4] = {0, 0, 0, 0};
        if (rcmd->commandType == CLAY_RENDER_COMMAND_TYPE_RECTANGLE ||
            rcmd->commandType == CLAY_RENDER_COMMAND_TYPE_BORDER) {
            const Clay_CornerRadius c = rcmd->commandType == CLAY_RENDER_COMMAND_TYPE_RECTANGLE
                                            ? rcmd->renderData.rectangle.cornerRadius
                                            : rcmd->renderData.border.cornerRadius;
            rad[0] = c.topLeft, rad[1] = c.topRight, rad[2] = c.bottomRight, rad[3] = c.bottomLeft;
        }
        const Clay_Color fill = d->shadows[i].color;
        Tvg_Paint scene = tvg_scene_new();
        Tvg_Paint shape = tvg_shape_new();
        Clay_ThorVG_RoundRect(shape, x, y, w, h, rad, rad);
        tvg_shape_set_fill_color(shape, fill.r, fill.g, fill.b, fill.a);
        tvg_scene_add(scene, shape);
        // sigma is in the scene's own units, like the shape's coordinates: the root scene's scale applies to it too
        if (blur > 0)
            tvg_scene_add_effect_gaussian_blur(scene, CLAY_THORVG_SHADOW_SIGMA(blur), 0, 0,
                                               CLAY_THORVG_SHADOW_QUALITY);
        tvg_scene_add(into, scene);
    }
}

/** Gives the element with this id's hash a backdrop for the next draw (one a frame): the pixels under its box, blurred
 *  by blur before its own commands. A renderer effect, as the shadow. */
static void Clay_ThorVG_SetBackdrop(Clay_ThorVGRendererData *d, uint32_t id, float blur)
{
    // ponytail: 8 backdrops a frame (one cut is what is drawn, see the render), no list that grows
    if (d->backdropCount == (int)(sizeof d->backdrops / sizeof *d->backdrops)) return;
    d->backdrops[d->backdropCount].id = id;
    d->backdrops[d->backdropCount].blur = blur;
    d->backdropCount++;
}

/** The blur of the element with this id, or -1 when it has no backdrop. */
static float Clay_ThorVG_BackdropOf(Clay_ThorVGRendererData *d, uint32_t id)
{
    for (int i = 0; i < d->backdropCount; i++)
        if (d->backdrops[i].id == id) return d->backdrops[i].blur;
    return -1;
}

/** Gives the element at that index of the frame's tree a group for the next draw (one a frame): its subtree as one scene
 *  at `alpha` (0..255), `scale` about its box centre (1 = none), a `tx`/`ty` offset (px, 0 = none) and a `rotate` in
 *  degrees about the same centre (0 = none). Renderer effects, as the shadow: the page writes them through the value
 *  channel (fields 46 to 49 and 55), and the command stream's userData is what finds the subtree again. */
static void Clay_ThorVG_SetGroup(Clay_ThorVGRendererData *d, int at, int alpha, float scale, float tx, float ty,
                                 float rotate)
{
    if (alpha < 0) alpha = 0;
    if (alpha > 255) alpha = 255;
    if (scale < 0.01f) scale = 0.01f;
    for (int i = 0; i < d->groupCount; i++)
        if (d->groups[i].at == at) {
            d->groups[i].alpha = alpha, d->groups[i].scale = scale, d->groups[i].tx = tx, d->groups[i].ty = ty,
            d->groups[i].rotate = rotate;
            return;
        }
    if (d->groupCount == CLAY_THORVG_MAX_GROUPS) return; // ponytail: 16 groups a frame; more needs a table that grows
    d->groups[d->groupCount].at = at;
    d->groups[d->groupCount].alpha = alpha;
    d->groups[d->groupCount].scale = scale;
    d->groups[d->groupCount].tx = tx;
    d->groups[d->groupCount].ty = ty;
    d->groups[d->groupCount].rotate = rotate;
    d->groupCount++;
}

/** A group's command range in the frame, and what its scene is made to look like: the range's first command's box
 *  centre is the scale's and the rotation's origin. */
typedef struct {
    int32_t start, end;
    int alpha;
    float scale;
    float tx, ty;
    float rotate;
    float cx, cy;
} Clay_ThorVG_GroupSpan;

/** Is the tree node `node` the element `at`, or one of its descendants? */
static bool Clay_ThorVG_Under(Clay_ThorVGRendererData *d, int32_t at, int32_t node)
{
    for (int32_t n = node, guard = 0; n >= 0 && guard <= d->treeCount; n = d->tree[n].parent, guard++)
        if (n == at) return true;
    return false;
}

/** Puts a group's scene into its parent scene with its opacity, its scale and rotation about the range's box centre and
 *  its translate. ThorVG's matrix is read as `x' = x·e11 + y·e12 + e13`, `y' = x·e21 + y·e22 + e23` (tvg::operator* in
 *  its tvgMath.cpp; its third row is not used), so one matrix carries all three: the scale, then the rotation, then the
 *  translate, about c —
 *  `x' = s·((x - cx)·cos − (y - cy)·sin) + cx + tx`, `y' = s·((x - cx)·sin + (y - cy)·cos) + cy + ty`
 *  — which is `s·R` on the diagonal and `c - (s·R)·c + t` in e13/e23, and reduces to the old `scale`/`c·(1 - scale) + t`
 *  at 0 degrees. A positive angle turns the scene clockwise on screen (y runs down), so a page's tilt is its sign. */
static void Clay_ThorVG_SettleGroup(const Clay_ThorVG_GroupSpan *g, Tvg_Paint scene)
{
    if (g->alpha < 255) tvg_paint_set_opacity(scene, (uint8_t)g->alpha);
    if (g->scale == 1 && g->tx == 0 && g->ty == 0 && g->rotate == 0) return;
    if (g->rotate == 0) {
        // the matrix a page without a lean has always got, expression and all: `c·(1 - scale) + t` rounds differently
        // from the rotation's `c + t - scale·c`, and the mid-frames of a scaled group must stay byte-identical
        const Tvg_Matrix m = {g->scale, 0, g->cx * (1 - g->scale) + g->tx, 0, g->scale,
                              g->cy * (1 - g->scale) + g->ty, 0, 0, 1};
        tvg_paint_set_transform(scene, &m);
        return;
    }
    // scale, then rotate, then translate, about c: s·R on the diagonal and c - (s·R)·c + t in the third column
    const float rad = g->rotate * CLAY_THORVG_PI / 180.0f;
    const float cosv = cosf(rad), sinv = sinf(rad);
    const float a = g->scale * cosv, b = -g->scale * sinv; // e11, e12 of the linear part
    const Tvg_Matrix m = {a,
                          b,
                          g->cx + g->tx - (a * g->cx + b * g->cy),
                          -b,
                          a,
                          g->cy + g->ty - (-b * g->cx + a * g->cy),
                          0,
                          0,
                          1};
    tvg_paint_set_transform(scene, &m);
}

/** Gives the element with this id's hash a background image for the next draw (one a frame): a linear gradient that fills
 *  the element's box instead of its solid background. `stops` is `count` rows of (offset 0..1, r, g, b, a). A renderer
 *  effect, as the shadow: no Clay field holds one, and the command stream's id is what finds it again. */
static void Clay_ThorVG_SetBackgroundImage(Clay_ThorVGRendererData *d, uint32_t id, int kind, float angle, int count,
                                           const float stops[][5], int alpha)
{
    // ponytail: 16 gradients a frame, 8 stops each, one an element; more needs a table that grows
    if (d->gradientCount == (int)(sizeof d->gradients / sizeof *d->gradients)) return;
    if (count < 2) return;
    if (count > 8) count = 8;
    if (alpha < 0) alpha = 0;
    if (alpha > 255) alpha = 255;
    int i = d->gradientCount++;
    d->gradients[i].id = id;
    d->gradients[i].kind = kind;
    d->gradients[i].angle = angle;
    d->gradients[i].count = count;
    d->gradients[i].alpha = alpha;
    for (int k = 0; k < count; k++) {
        d->gradients[i].offset[k] = stops[k][0];
        d->gradients[i].color[k] = (Clay_Color){stops[k][1], stops[k][2], stops[k][3], stops[k][4]};
    }
    d->gradients[i].drawn = false;
    d->gradients[i].area.on = false;
}

/** The gradient of the element with this id, at its `*at`, if it has one it has not drawn yet; false when it has none. */
static bool Clay_ThorVG_GradientOf(Clay_ThorVGRendererData *d, uint32_t id, int *at)
{
    for (int i = 0; i < d->gradientCount; i++)
        if (d->gradients[i].id == id && !d->gradients[i].drawn) return (*at = i), true;
    return false;
}

/** Fills a shape with a linear gradient along CSS's gradient line: the direction (sin θ, -cos θ) (0deg is up, 90 right),
 *  the line's length |w·sinθ| + |h·cosθ| (the box's projection on it), from the box's centre out to both ends. The
 *  coordinates are the shape's own, the same space as its path: the root scene carries the pixel density, as for a
 *  shadow's sigma. */
static void Clay_ThorVG_FillGradient(Tvg_Paint s, const float angle, int count, const float *offset,
                                     const Clay_Color *color, float x, float y, float w, float h)
{
    const float rad = angle * CLAY_THORVG_PI / 180.0f;
    const float dx = sinf(rad), dy = -cosf(rad);
    const float len = fabsf(w * dx) + fabsf(h * dy);
    const float cx = x + w / 2, cy = y + h / 2;
    Tvg_Color_Stop stops[8];
    for (int i = 0; i < count; i++)
        stops[i] = (Tvg_Color_Stop){offset[i], (uint8_t)color[i].r, (uint8_t)color[i].g, (uint8_t)color[i].b,
                                    (uint8_t)color[i].a};
    Tvg_Gradient grad = tvg_linear_gradient_new();
    tvg_linear_gradient_set(grad, cx - dx * len / 2, cy - dy * len / 2, cx + dx * len / 2, cy + dy * len / 2);
    tvg_gradient_set_color_stops(grad, stops, (uint32_t)count);
    // the shape takes the gradient: setting the fill hands it over, so there is no tvg_gradient_del of ours
    tvg_shape_set_gradient(s, grad);
}

// The scene's map to the target, as the groups open around a command make it: one affine in Clay units,
// `x' = xx·x + xy·y + tx`, `y' = yx·x + yy·y + ty` (the root scene's scale is applied after it). A group is a scale
// about its box's centre, a rotation about the same centre and an offset; the map composes them down the open groups, so
// a command inside a rotated group knows where its box really is. The drawn clip needs nothing from this (its scene is
// inside the group's, so ThorVG turns it), but the dither works on the target's pixels after the draw, and it uses the
// map to know a gradient's pixels: `turn` says a rotation is in the map, and then a gradient's mark is the four mapped
// corners' quad, tested a pixel at a time, instead of the axis-aligned box an unrotated map gives — that box would stipple
// the page around the quad and miss the quad's tips. A clip is the same: its scene is turned by ThorVG, and the dither
// records the quad its box maps to, so a gradient inside a rotated clip is stippled inside the clip's tilt and not its
// bounding box. solid/rotated.test.ts proves both turned paths on a hand-built tree.
typedef struct {
    float xx, xy, yx, yy; // the linear part
    float tx, ty;         // ... and the offset
    bool turn;            // a rotation is in the map: a mark is a quad, not an axis-aligned box
} Clay_ThorVG_Map;

// A clip open at a command, for the dither after the draw: the whole-pixel rect the mark is cut to, and — when the scene
// the clip was declared in is turned — the quad that rect bounds. The rect alone cuts a page with no lean exactly; a
// turned clip's rect is the conservative bound, so the dither also tests the pixel against the quad.
typedef struct {
    int rect[4];      // {x0, y0, x1, y1} in device pixels, for the scan
    float qx[4], qy[4]; // the clip's box through the map, in device pixels
    bool turned;      // the rect is the quad's bounding box: a pixel must be in the quad as well
} Clay_ThorVG_Clip;

/** A point through the map, in Clay units. Without a turn the expressions are the ones the renderer always had, so a page
 *  that never leans keeps its frames byte for byte (`a·x + b` and `a·y + b`, no cross term added). */
static inline float Clay_ThorVG_MapX(const Clay_ThorVG_Map *m, float x, float y)
{
    return m->turn ? m->xx * x + m->xy * y + m->tx : m->xx * x + m->tx;
}

static inline float Clay_ThorVG_MapY(const Clay_ThorVG_Map *m, float x, float y)
{
    return m->turn ? m->yx * x + m->yy * y + m->ty : m->yy * y + m->ty;
}

/** Where the gradient at `at` was drawn, for the dither after the draw: its box under the groups' map `m`, cut to the
 *  canvas and to the clips (whose rects are already in device pixels, from the map of the scene they were made in), with
 *  each corner's arc so the page beyond a rounded corner gets no noise. An unrotated map marks the box; a turned one marks
 *  the quad its four corners make, and keeps the inverse map so the dither can ask a pixel where it is in the shape. A
 *  turned clip keeps its quad too: its rect is the quad's bounding box, so the dither tests a pixel against the quad. */
static void Clay_ThorVG_MarkGradient(Clay_ThorVGRendererData *d, int at, float x, float y, float w, float h,
                                     const float rad[4], Clay_ThorVG_Map m, const Clay_ThorVG_Clip *clips,
                                     int clipCount)
{
    if (!d->target) return; // no buffer to stipple: the WebGPU canvas reads its frame back after the draw
    const float s = d->scale;
    int x0, y0, x1, y1;
    if (m.turn) {
        // the box's four corners through the map: the quad the gradient covers, and the box of that quad
        const float xs[4] = {x, x + w, x + w, x}, ys[4] = {y, y, y + h, y + h};
        float lo[2] = {1e30f, 1e30f}, hi[2] = {-1e30f, -1e30f};
        for (int k = 0; k < 4; k++) {
            const float mx = Clay_ThorVG_MapX(&m, xs[k], ys[k]) * s, my = Clay_ThorVG_MapY(&m, xs[k], ys[k]) * s;
            lo[0] = fminf(lo[0], mx), hi[0] = fmaxf(hi[0], mx);
            lo[1] = fminf(lo[1], my), hi[1] = fmaxf(hi[1], my);
        }
        x0 = (int)floorf(lo[0]), x1 = (int)ceilf(hi[0]);
        y0 = (int)floorf(lo[1]), y1 = (int)ceilf(hi[1]);
    } else {
        x0 = (int)ceilf((m.xx * x + m.tx) * s), x1 = (int)floorf((m.xx * (x + w) + m.tx) * s);
        y0 = (int)ceilf((m.yy * y + m.ty) * s), y1 = (int)floorf((m.yy * (y + h) + m.ty) * s);
    }
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > d->targetWidth) x1 = d->targetWidth;
    if (y1 > d->targetHeight) y1 = d->targetHeight;
    for (int c = 0; c < clipCount; c++) {
        if (clips[c].rect[0] > x0) x0 = clips[c].rect[0];
        if (clips[c].rect[1] > y0) y0 = clips[c].rect[1];
        if (clips[c].rect[2] < x1) x1 = clips[c].rect[2];
        if (clips[c].rect[3] < y1) y1 = clips[c].rect[3];
    }
    if (x1 <= x0 || y1 <= y0) return;
    // the turned clips' quads the mark must stay inside: the rect above is only their bounding box
    int cut = 0;
    for (int c = 0; c < clipCount; c++) {
        if (!clips[c].turned) continue;
        for (int k = 0; k < 4; k++) {
            d->gradients[at].area.cutX[cut][k] = clips[c].qx[k];
            d->gradients[at].area.cutY[cut][k] = clips[c].qy[k];
        }
        cut++;
    }
    d->gradients[at].area.cutCount = cut;
    const float ccx[4] = {x + rad[0], x + w - rad[1], x + w - rad[2], x + rad[3]};
    const float ccy[4] = {y + rad[0], y + rad[1], y + h - rad[2], y + h - rad[3]};
    if (m.turn) {
        // the inverse of the map, in device pixels: u = (m.yy·(X/s - tx) - m.xy·(Y/s - ty)) / det, and v with the other
        // row. The box and the arcs stay the shape's own, so a pixel outside the quad (or beyond a rounded corner's arc)
        // is the page and is not stippled
        const float det = m.xx * m.yy - m.xy * m.yx;
        const float ixx = m.yy / det, ixy = -m.xy / det, iyx = -m.yx / det, iyy = m.xx / det;
        d->gradients[at].area.uxx = ixx / s, d->gradients[at].area.uxy = ixy / s;
        d->gradients[at].area.uyx = iyx / s, d->gradients[at].area.uyy = iyy / s;
        d->gradients[at].area.utx = -(ixx * m.tx + ixy * m.ty);
        d->gradients[at].area.uty = -(iyx * m.tx + iyy * m.ty);
        d->gradients[at].area.bx0 = x, d->gradients[at].area.bx1 = x + w;
        d->gradients[at].area.by0 = y, d->gradients[at].area.by1 = y + h;
        for (int c = 0; c < 4; c++) {
            d->gradients[at].area.kcx[c] = ccx[c];
            d->gradients[at].area.kcy[c] = ccy[c];
            d->gradients[at].area.kr[c] = rad[c];
        }
        d->gradients[at].area.turn = true;
    } else {
        // the corners' arcs, as the shape was given them: each centre in target pixels, its radius in the map's scale
        for (int c = 0; c < 4; c++) {
            d->gradients[at].area.cx[c] = (m.xx * ccx[c] + m.tx) * s;
            d->gradients[at].area.cy[c] = (m.yy * ccy[c] + m.ty) * s;
            d->gradients[at].area.r[c] = rad[c] * m.xx * s;
        }
        d->gradients[at].area.turn = false;
    }
    d->gradients[at].area.x0 = x0, d->gradients[at].area.y0 = y0;
    d->gradients[at].area.x1 = x1, d->gradients[at].area.y1 = y1;
    d->gradients[at].area.on = true;
}

/** Is the point (px, py), in the box's own units, inside the rounded box: outside a corner's arc it is not, and that is
 *  the page. The test is one pixel inside the arc's radius, so the raster's antialiased fringe at a corner (a blend of the
 *  page and the gradient, which can come out as the page itself) is left as drawn: no pixel of the page moves. A turned
 *  mark asks the same question of the same box, of the point its pixel maps back to. */
static bool Clay_ThorVG_InRoundBoxAt(const float *cx, const float *cy, const float *r, float px, float py)
{
    for (int c = 0; c < 4; c++) {
        if (r[c] <= 1) continue;
        const bool left = c == 0 || c == 3, top = c < 2;
        if ((left ? px < cx[c] : px > cx[c]) && (top ? py < cy[c] : py > cy[c])) {
            const float dx = px - cx[c], dy = py - cy[c], r1 = r[c] - 1;
            if (dx * dx + dy * dy > r1 * r1) return false;
        }
    }
    return true;
}

/** The same for the pixel at x, y: its centre is the point, as it always was. */
static bool Clay_ThorVG_InRoundBox(const float *cx, const float *cy, const float *r, int x, int y)
{
    return Clay_ThorVG_InRoundBoxAt(cx, cy, r, x + 0.5f, y + 0.5f);
}

// The dither: 4x4 ordered (Bayer), thresholds 0..15. An 8-bit channel turns the cards' 6/255 ramp over 190px into six
// bands of ~30px, and no raster here has more levels, so the box's pixels step by one level: at a 4px tile the edge of a
// band reads as a half-level blend instead of a step. `CLAY_THORVG_DITHER` picks the step (see its uses below); the tile
// is what the page's scale makes of one device pixel, so the pattern is the same at any density.
static const uint8_t Clay_ThorVG_Bayer4[16] = {0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5};

#ifndef CLAY_THORVG_DITHER
// 2: one level either way (the mean is kept; measured: the light card's white top clips a +1 step, so 2 stipples it and
// 1 leaves a flat band there, while a +1 mean is invisible on any card). 1: one level up on half the pixels; 0: none.
#define CLAY_THORVG_DITHER 2
#endif

/** One pixel's step: the three channels, clamped (the box may hold the ink's 255 or a photo's 0). */
static inline void Clay_ThorVG_DitherPixel(uint8_t *q, int d)
{
    for (int c = 0; c < 3; c++) {
        const int v = q[c] + d;
        q[c] = (uint8_t)(v < 0 ? 0 : (v > 255 ? 255 : v));
    }
}

/** Is the point inside a convex quad (the four corners in order)? The cross products of each edge with the point all
 *  have the same sign; it is always on the inside. Used for a turned clip's quad, whose rect is only its bounding box. */
static bool Clay_ThorVG_InQuad(const float *X, const float *Y, float px, float py)
{
    int sign = 0;
    for (int i = 0; i < 4; i++) {
        const int j = (i + 1) & 3;
        const float cross = (X[j] - X[i]) * (py - Y[i]) - (Y[j] - Y[i]) * (px - X[i]);
        if (cross == 0) continue;
        const int s = cross > 0 ? 1 : -1;
        if (sign == 0) sign = s;
        else if (s != sign) return false;
    }
    return true;
}

/** Whether a pixel is in every turned clip the gradient was drawn inside. */
static bool Clay_ThorVG_InsideCuts(const Clay_ThorVG_GradientArea *a, float px, float py)
{
    for (int c = 0; c < a->cutCount; c++)
        if (!Clay_ThorVG_InQuad(a->cutX[c], a->cutY[c], px, py)) return false;
    return true;
}

/** Stipples the pixels each gradient drew, in the target, after the frame: nothing outside a gradient's mark is read or
 *  written, and a frame with no gradient (which the table then holds none of) is untouched. An unrotated mark is the
 *  box: a row between the corner bands is its whole width, untested, and only a corner's band tests its arc, a pixel at a
 *  time. A turned mark is the quad: every pixel of its bounding box is mapped back into the shape and tested against the
 *  box and its arcs, so the page around the quad — which an axis-aligned box would have covered — is left alone. A turned
 *  clip is the same question of the clip's quad, so a pixel the clip cut away is never stippled. */
static void Clay_ThorVG_DitherGradients(Clay_ThorVGRendererData *d)
{
#if CLAY_THORVG_DITHER == 0
    return; // the baseline: the ramp as the raster leaves it
#else
    uint32_t *px = d->target;
    if (!px) return;
    const int tw = d->targetWidth;
    for (int i = 0; i < d->gradientCount; i++) {
        if (!d->gradients[i].area.on) continue;
        const bool turn = d->gradients[i].area.turn;
        const float *cx = d->gradients[i].area.cx, *cy = d->gradients[i].area.cy, *r = d->gradients[i].area.r;
        const int x0 = d->gradients[i].area.x0, x1 = d->gradients[i].area.x1;
        const int y0 = d->gradients[i].area.y0, y1 = d->gradients[i].area.y1;
        for (int y = y0; y < y1; y++) {
            // the row's four thresholds, from the tile's row of the matrix
            const int phase = (y & 3) * 4;
            int add[4];
            for (int k = 0; k < 4; k++) {
#if CLAY_THORVG_DITHER == 1
                add[k] = Clay_ThorVG_Bayer4[phase + k] < 8 ? 1 : 0;
#elif CLAY_THORVG_DITHER == 2
                add[k] = Clay_ThorVG_Bayer4[phase + k] < 8 ? 1 : -1;
#else
                add[k] = 0;
#endif
            }
            uint8_t *row = (uint8_t *)(px + (size_t)y * tw);
            if (turn) {
                // the quad: the pixel's centre through the inverse map, then the shape's own box and corner arcs, and
                // the turned clips around it
                const float py = y + 0.5f;
                for (int x = x0; x < x1; x++) {
                    const float pxf = x + 0.5f;
                    const float u = d->gradients[i].area.uxx * pxf + d->gradients[i].area.uxy * py +
                                    d->gradients[i].area.utx;
                    const float v = d->gradients[i].area.uyx * pxf + d->gradients[i].area.uyy * py +
                                    d->gradients[i].area.uty;
                    if (u < d->gradients[i].area.bx0 || u > d->gradients[i].area.bx1 || v < d->gradients[i].area.by0 ||
                        v > d->gradients[i].area.by1)
                        continue;
                    if (!Clay_ThorVG_InRoundBoxAt(d->gradients[i].area.kcx, d->gradients[i].area.kcy,
                                                  d->gradients[i].area.kr, u, v))
                        continue;
                    if (!Clay_ThorVG_InsideCuts(&d->gradients[i].area, pxf, py)) continue;
                    Clay_ThorVG_DitherPixel(row + (size_t)x * 4, add[x & 3]);
                }
                continue;
            }
            // each corner's band, in whole pixels outwards: the arc's test then covers every pixel the corner can reach
            int rc[4];
            for (int c = 0; c < 4; c++) rc[c] = (int)ceilf(r[c]);
            // the corner columns this row has (the arc's radius, if the row is in that corner's band)
            const int rl = y < y0 + rc[0] ? rc[0] : (y >= y1 - rc[3] ? rc[3] : 0);
            const int rr = y < y0 + rc[1] ? rc[1] : (y >= y1 - rc[2] ? rc[2] : 0);
            int left = x0 + rl, right = x1 - rr;
            if (left > x1) left = x1;
            if (right < left) right = left;
            for (int x = x0; x < left; x++)
                if (Clay_ThorVG_InRoundBox(cx, cy, r, x, y) && Clay_ThorVG_InsideCuts(&d->gradients[i].area, x + 0.5f, y + 0.5f))
                    Clay_ThorVG_DitherPixel(row + (size_t)x * 4, add[x & 3]);
            if (d->gradients[i].area.cutCount) {
                for (int x = left; x < right; x++)
                    if (Clay_ThorVG_InsideCuts(&d->gradients[i].area, x + 0.5f, y + 0.5f))
                        Clay_ThorVG_DitherPixel(row + (size_t)x * 4, add[x & 3]);
            } else {
                for (int x = left; x < right; x++) Clay_ThorVG_DitherPixel(row + (size_t)x * 4, add[x & 3]);
            }
            for (int x = right; x < x1; x++)
                if (Clay_ThorVG_InRoundBox(cx, cy, r, x, y) && Clay_ThorVG_InsideCuts(&d->gradients[i].area, x + 0.5f, y + 0.5f))
                    Clay_ThorVG_DitherPixel(row + (size_t)x * 4, add[x & 3]);
        }
    }
#endif
}

// The backdrop blur's machine: a separable box blur, three passes each way, which is a gaussian to the eye and has no
// kernel to build. A pass of radius r three times has the variance (r^2 + r) of a gaussian, so CSS's blur radius (sigma
// = blur / 2, the shadow's reading) picks r = (sqrt(1 + 4 sigma^2) - 1) / 2.
#define CLAY_THORVG_BACKDROP_PASSES 3

/** A box blur of one row, radius r, the window clamped to the row's ends (the box's own edge is not pulled in from
 *  outside it). Alpha is copied through: the target's is 255 everywhere.
 *  Three sums and a division a pixel; n is the same for the whole blur, so the division is a multiply the compiler
 *  hoists (measured: 0.11 ms a pass each way for a 150x133 box at any radius up to 16, the traffic being the cost).
 *  ponytail: three integer sums a pixel, no SIMD, no half-resolution pass; the region is what keeps it small. */
static void Clay_ThorVG_BoxBlurH(const uint8_t *src, uint8_t *dst, int w, int h, int r)
{
    const int n = 2 * r + 1;
    for (int y = 0; y < h; y++) {
        const uint8_t *s = src + (size_t)y * w * 4;
        uint8_t *o = dst + (size_t)y * w * 4;
        int sr = 0, sg = 0, sb = 0;
        for (int i = -r; i <= r; i++) {
            const int x = i < 0 ? 0 : (i >= w ? w - 1 : i);
            sr += s[x * 4], sg += s[x * 4 + 1], sb += s[x * 4 + 2];
        }
        for (int x = 0; x < w; x++) {
            o[x * 4] = (uint8_t)(sr / n), o[x * 4 + 1] = (uint8_t)(sg / n), o[x * 4 + 2] = (uint8_t)(sb / n);
            o[x * 4 + 3] = s[x * 4 + 3];
            const int out = x - r < 0 ? 0 : x - r, in = x + r + 1 >= w ? w - 1 : x + r + 1;
            sr += s[in * 4] - s[out * 4], sg += s[in * 4 + 1] - s[out * 4 + 1], sb += s[in * 4 + 2] - s[out * 4 + 2];
        }
    }
}

/** The same for one column. */
static void Clay_ThorVG_BoxBlurV(const uint8_t *src, uint8_t *dst, int w, int h, int r)
{
    const int n = 2 * r + 1;
    const size_t stride = (size_t)w * 4;
    for (int x = 0; x < w; x++) {
        const uint8_t *s = src + (size_t)x * 4;
        uint8_t *o = dst + (size_t)x * 4;
        int sr = 0, sg = 0, sb = 0;
        for (int i = -r; i <= r; i++) {
            const uint8_t *p = s + (size_t)(i < 0 ? 0 : (i >= h ? h - 1 : i)) * stride;
            sr += p[0], sg += p[1], sb += p[2];
        }
        for (int y = 0; y < h; y++) {
            uint8_t *q = o + (size_t)y * stride;
            q[0] = (uint8_t)(sr / n), q[1] = (uint8_t)(sg / n), q[2] = (uint8_t)(sb / n), q[3] = s[y * stride + 3];
            const int out = y - r < 0 ? 0 : y - r, in = y + r + 1 >= h ? h - 1 : y + r + 1;
            sr += s[in * stride] - s[out * stride], sg += s[in * stride + 1] - s[out * stride + 1],
                sb += s[in * stride + 2] - s[out * stride + 2];
        }
    }
}

/** Blurs the box of a backdrop's first command in the target, and only it: the box clipped to the canvas, two buffers of
 *  the region, three passes. Nothing outside the box is read or written, so the frame around it is untouched. */
static void Clay_ThorVG_BlurBackdrop(Clay_ThorVGRendererData *d, Clay_RenderCommand *rcmd, float blur)
{
    uint32_t *px = d->target;
    if (!px || blur <= 0) return;
    const int tw = d->targetWidth, th = d->targetHeight;
    int x0 = (int)floorf(rcmd->boundingBox.x * d->scale), y0 = (int)floorf(rcmd->boundingBox.y * d->scale);
    int x1 = (int)ceilf((rcmd->boundingBox.x + rcmd->boundingBox.width) * d->scale);
    int y1 = (int)ceilf((rcmd->boundingBox.y + rcmd->boundingBox.height) * d->scale);
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > tw) x1 = tw;
    if (y1 > th) y1 = th;
    const int w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    // sigma in device pixels, and the box radius of one of the three passes
    const float sigma = blur * d->scale / 2.0f;
    int r = (int)lroundf((sqrtf(1 + 4 * sigma * sigma) - 1) / 2);
    if (r < 1) r = 1;
    // ponytail: two buffers of the box, malloc'd a blur; a page that blurs every frame could keep them (and would need
    // the largest box it has seen)
    const size_t bytes = (size_t)w * h * 4;
    uint8_t *a = malloc(bytes), *b = malloc(bytes);
    if (!a || !b) {
        free(a), free(b);
        return;
    }
    for (int y = 0; y < h; y++) memcpy(a + (size_t)y * w * 4, px + (size_t)(y0 + y) * tw + x0, (size_t)w * 4);
    for (int pass = 0; pass < CLAY_THORVG_BACKDROP_PASSES; pass++) {
        Clay_ThorVG_BoxBlurH(a, b, w, h, r);
        Clay_ThorVG_BoxBlurV(b, a, w, h, r);
    }
    for (int y = 0; y < h; y++) memcpy(px + (size_t)(y0 + y) * tw + x0, a + (size_t)y * w * 4, (size_t)w * 4);
    free(a), free(b);
}

/** Rebuilds the canvas from the commands and draws it into the target buffer, over what the buffer holds (or, with
 *  d->clear, clearing it first); false if the canvas could not sync its target. */
static bool Clay_ThorVG_RenderClayCommands(Clay_ThorVGRendererData *d, Clay_RenderCommandArray *rcommands)
{
    tvg_canvas_remove(d->canvas, NULL);
    // Which element each command belongs to: `userData` is the node's index in the frame's tree + 1 (ui.c). A command
    // that carries none — a scissor's own start or end, which Clay emits from an id it derives itself — belongs to the
    // last element that had one; it is emitted inside that element's subtree, so it cannot widen a group past it.
    const int32_t n = rcommands->length;
    // Each group's range: the commands whose element is the group's element or under it. A group with nothing animated
    // (alpha 255, scale 1, no translate) gets no range, so a settled page is drawn exactly as the literal makes it.
    Clay_ThorVG_GroupSpan spans[CLAY_THORVG_MAX_GROUPS];
    int32_t spanAt[CLAY_THORVG_MAX_GROUPS];
    int spanCount = 0;
    for (int g = 0; g < d->groupCount; g++) {
        if (d->groups[g].alpha >= 255 && d->groups[g].scale == 1 && d->groups[g].tx == 0 && d->groups[g].ty == 0 &&
            d->groups[g].rotate == 0)
            continue;
        spans[spanCount] = (Clay_ThorVG_GroupSpan){.start = n, .end = -1, .alpha = d->groups[g].alpha,
                                                   .scale = d->groups[g].scale, .tx = d->groups[g].tx,
                                                   .ty = d->groups[g].ty, .rotate = d->groups[g].rotate};
        spanAt[spanCount++] = d->groups[g].at;
    }
    int32_t last = -1;
    for (int32_t i = 0; i < n; i++) {
        Clay_RenderCommand *rcmd = Clay_RenderCommandArray_Get(rcommands, i);
        const uintptr_t node = (uintptr_t)rcmd->userData;
        if (node) last = (int32_t)(node - 1);
        for (int s = 0; s < spanCount; s++) {
            if (!Clay_ThorVG_Under(d, spanAt[s], last)) continue;
            if (spans[s].start > spans[s].end) spans[s].start = i;
            spans[s].end = i;
        }
    }
    // the empty ones go, and the rest are ordered so a group that contains another is opened first: by start, and the
    // longer range first where two start together
    int kept = 0;
    for (int s = 0; s < spanCount; s++) {
        if (spans[s].start > spans[s].end) continue;
        Clay_RenderCommand *first = Clay_RenderCommandArray_Get(rcommands, spans[s].start);
        spans[s].cx = first->boundingBox.x + first->boundingBox.width / 2;
        spans[s].cy = first->boundingBox.y + first->boundingBox.height / 2;
        spans[kept++] = spans[s];
    }
    spanCount = kept;
    for (int a = 1; a < spanCount; a++) {
        const Clay_ThorVG_GroupSpan s = spans[a];
        int b = a - 1;
        while (b >= 0 && (spans[b].start > s.start || (spans[b].start == s.start && spans[b].end < s.end))) {
            spans[b + 1] = spans[b];
            b--;
        }
        spans[b + 1] = s;
    }

    Tvg_Paint root = tvg_scene_new(), into = root;
    tvg_paint_scale(root, d->scale);
    d->cut = false;
    // the scenes open at this command: a group (whose scene may be closed by a backdrop's cut and made again) and a
    // scissor (whose scene is always inside the one that was current when it started)
    const Clay_ThorVG_GroupSpan *openSpan[CLAY_THORVG_MAX_NESTING];
    Tvg_Paint openScene[CLAY_THORVG_MAX_NESTING], openParent[CLAY_THORVG_MAX_NESTING];
    int openCount = 0;
    Tvg_Paint clipParent[CLAY_THORVG_MAX_SCISSORS];
    int clipDepth = 0;
    // the clips open at the current command, in device pixels, and the groups' map to the target: what cuts a gradient's
    // mark for the dither (both are needed because a gradient may sit in a clipped, scrolled feed). A clip's rect cuts
    // exactly while its scene is square; a turned one records its quad, and the dither tests the pixel against it.
    Clay_ThorVG_Clip clipStack[CLAY_THORVG_MAX_SCISSORS];
    Clay_ThorVG_Map map = {1, 0, 0, 1, 0, 0, false}, openMap[CLAY_THORVG_MAX_NESTING];
    int nextSpan = 0;
    for (int32_t i = 0; i < n; i++) {
        // a group starts at the first command of its subtree, before the element's shadow, so the shadow is inside it (a
        // shadow fades with the panel it belongs to) and before the cut test below, which may have to close it
        while (nextSpan < spanCount && spans[nextSpan].start <= i) {
            const Clay_ThorVG_GroupSpan *g = &spans[nextSpan++];
            if (openCount == CLAY_THORVG_MAX_NESTING) continue; // ponytail: four open groups; a fifth is ungrouped
            openSpan[openCount] = g;
            openParent[openCount] = into;
            openScene[openCount] = tvg_scene_new();
            tvg_scene_add(into, openScene[openCount]);
            into = openScene[openCount];
            // the group's own map, under the one already open (see Clay_ThorVG_Map). A page with no lean keeps the two
            // expressions it always had, so a scaled group's frames stay byte-identical; the general form composes a
            // rotation into the linear part, and turns the map, so a mark is the quad from there on.
            openMap[openCount] = map;
            if (g->rotate == 0 && !map.turn) {
                map.xx = g->scale * map.xx;
                map.yy = g->scale * map.yy;
                map.tx = g->scale * (map.tx - g->cx) + g->cx + g->tx;
                map.ty = g->scale * (map.ty - g->cy) + g->cy + g->ty;
            } else {
                const float rad = g->rotate * CLAY_THORVG_PI / 180.0f;
                const float cosv = cosf(rad), sinv = sinf(rad);
                const float gxx = g->scale * cosv, gxy = -g->scale * sinv;
                const float gyx = g->scale * sinv, gyy = g->scale * cosv;
                const float gtx = g->cx + g->tx - (gxx * g->cx + gxy * g->cy);
                const float gty = g->cy + g->ty - (gyx * g->cx + gyy * g->cy);
                const float xx = gxx * map.xx + gxy * map.yx, xy = gxx * map.xy + gxy * map.yy;
                const float yx = gyx * map.xx + gyy * map.yx, yy = gyx * map.xy + gyy * map.yy;
                const float tx = gxx * map.tx + gxy * map.ty + gtx;
                const float ty = gyx * map.tx + gyy * map.ty + gty;
                map.xx = xx, map.xy = xy, map.yx = yx, map.yy = yy, map.tx = tx, map.ty = ty;
                map.turn = true;
            }
            openCount++;
        }
        Clay_RenderCommand *rcmd = Clay_RenderCommandArray_Get(rcommands, i);
        // a shadow of this element (css.shadow) goes before its first command, in the same scene as the command
        Clay_ThorVG_DrawShadow(d, rcmd, into);
        // whole pixels, as Clay's SDL3 renderer
        const float x = (int)rcmd->boundingBox.x, y = (int)rcmd->boundingBox.y;
        const float w = (int)rcmd->boundingBox.width, h = (int)rcmd->boundingBox.height;
        // a backdrop (css.backdrop): everything under the element has been drawn (its shadow too, which lies on the
        // unblurred page), so draw this pass, blur the element's box in the buffer, and carry on in a new scene over the
        // blurred pixels. The element's own commands — its fill, its text, its border — land in that second pass and stay
        // crisp. One cut a frame: glass under glass would need the first panel's pixels, and a second cut would read a
        // frame the first one has already drawn.
        // ponytail: only a rectangle cuts, and only outside a scissor scene; a backdrop inside a clip is not blurred, and
        // neither is one on the WebGPU canvas (it has no target to read before the whole frame is drawn). A cut inside a
        // group wins over it: the groups open here are settled into pass 1 (their scenes are already in it) and made
        // again in the new root after the cut, so the rest of the subtree is composited the same way — a group is never
        // cut in two by the scene, only by the frame's own pass.
        if (d->target && !d->cut && clipDepth == 0 && rcmd->commandType == CLAY_RENDER_COMMAND_TYPE_RECTANGLE &&
            Clay_ThorVG_BackdropOf(d, rcmd->id) >= 0) {
            d->cut = true;
            const int reopened = openCount;
            for (int k = openCount - 1; k >= 0; k--) {
                Clay_ThorVG_SettleGroup(openSpan[k], openScene[k]);
                into = openParent[k];
            }
            openCount = 0;
            tvg_canvas_add(d->canvas, root);
            tvg_canvas_draw(d->canvas, d->clear);
            if (tvg_canvas_sync(d->canvas) != TVG_RESULT_SUCCESS) return false;
            // taken off the canvas so the second draw does not overdraw the blur with it; ThorVG's canvas owns it from
            // add to remove, so there is no reference of ours to release (tvg_paint_rel here is a double free)
            tvg_canvas_remove(d->canvas, root);
            Clay_ThorVG_BlurBackdrop(d, rcmd, Clay_ThorVG_BackdropOf(d, rcmd->id));
            root = tvg_scene_new(), into = root;
            tvg_paint_scale(root, d->scale);
            for (int k = 0; k < reopened; k++) {
                openParent[k] = into;
                openScene[k] = tvg_scene_new();
                tvg_scene_add(into, openScene[k]);
                into = openScene[k];
            }
            openCount = reopened;
            // ThorVG's software canvas seeds its working surface from the target on its first draw and replaces what a
            // later draw's paints touch: setting the same target again is what lets this pass composite the panel over
            // the blurred pixels (measured: without it a translucent fill comes out as its own alpha, and a scene
            // effect drawn in the pass before wipes the frame). A WebGPU canvas has no target here, and no cut.
            if (d->target)
                tvg_swcanvas_set_target(d->canvas, d->target, d->targetWidth, d->targetWidth, d->targetHeight,
                                        TVG_COLORSPACE_ABGR8888);
        }
        switch (rcmd->commandType) {
        case CLAY_RENDER_COMMAND_TYPE_RECTANGLE: {
            const Clay_RectangleRenderData *r = &rcmd->renderData.rectangle;
            const Clay_CornerRadius c = r->cornerRadius;
            const float rad[4] = {c.topLeft, c.topRight, c.bottomRight, c.bottomLeft};
            Tvg_Paint s = tvg_shape_new();
            Clay_ThorVG_RoundRect(s, x, y, w, h, rad, rad);
            // a gradient (css.backgroundImage) fills the element's box instead of its solid colour: the first rectangle
            // command of the element takes it, drawn over the shadow and (after a backdrop's cut) over the blurred page
            int gradient;
            if (Clay_ThorVG_GradientOf(d, rcmd->id, &gradient)) {
                d->gradients[gradient].drawn = true;
                const int alpha = d->gradients[gradient].alpha;
                // an opaque gradient is the box's fill, as it always was. A fading one (a hover's) is composited over the
                // element's own solid colour, so what is under it is the background the page is animating: a cross-fade
                // between the two, and the solid is not drawn at 255 at all
                if (alpha < 255) {
                    Tvg_Paint under = tvg_shape_new();
                    Clay_ThorVG_RoundRect(under, x, y, w, h, rad, rad);
                    tvg_shape_set_fill_color(under, r->backgroundColor.r, r->backgroundColor.g, r->backgroundColor.b,
                                             r->backgroundColor.a);
                    tvg_scene_add(into, under);
                    tvg_paint_set_opacity(s, (uint8_t)alpha);
                }
                Clay_ThorVG_FillGradient(s, d->gradients[gradient].angle, d->gradients[gradient].count,
                                         d->gradients[gradient].offset, d->gradients[gradient].color, x, y, w, h);
                // ... and where it landed, for the dither after the frame: its pixels, not the page's
                Clay_ThorVG_MarkGradient(d, gradient, x, y, w, h, rad, map, clipStack, clipDepth);
            } else
                tvg_shape_set_fill_color(s, r->backgroundColor.r, r->backgroundColor.g, r->backgroundColor.b,
                                         r->backgroundColor.a);
            tvg_scene_add(into, s);
        } break;
        case CLAY_RENDER_COMMAND_TYPE_BORDER: {
            // inside the box: the outer edge is the box with its radii, the inner edge is inset by each side's
            // width, its corners the outer radii less the widths that meet there; the ring between is filled
            const Clay_BorderRenderData *r = &rcmd->renderData.border;
            const Clay_CornerRadius c = r->cornerRadius;
            const Clay_BorderWidth bw = r->width;
            const float rad[4] = {c.topLeft, c.topRight, c.bottomRight, c.bottomLeft};
            const float irx[4] = {c.topLeft - bw.left, c.topRight - bw.right, c.bottomRight - bw.right,
                                  c.bottomLeft - bw.left};
            const float iry[4] = {c.topLeft - bw.top, c.topRight - bw.top, c.bottomRight - bw.bottom,
                                  c.bottomLeft - bw.bottom};
            Tvg_Paint s = tvg_shape_new();
            Clay_ThorVG_RoundRect(s, x, y, w, h, rad, rad);
            const float iw = w - bw.left - bw.right, ih = h - bw.top - bw.bottom;
            if (iw > 0 && ih > 0) Clay_ThorVG_RoundRect(s, x + bw.left, y + bw.top, iw, ih, irx, iry);
            tvg_shape_set_fill_rule(s, TVG_FILL_RULE_EVEN_ODD);
            tvg_shape_set_fill_color(s, r->color.r, r->color.g, r->color.b, r->color.a);
            tvg_scene_add(into, s);
        } break;
        case CLAY_RENDER_COMMAND_TYPE_TEXT: {
            const Clay_TextRenderData *r = &rcmd->renderData.text;
            const float w = d->textWeight;
            tvg_scene_add(into, Clay_ThorVG_TextPaint(d, r, x - w / 2, y - w / 2));
            // the second copy is the weight: the union of the two is the glyph grown by w/2 in each direction, its centre
            // where Clay put it (the same line drawn once when w is 0)
            if (w > 0) tvg_scene_add(into, Clay_ThorVG_TextPaint(d, r, x + w / 2, y + w / 2));
        } break;
        case CLAY_RENDER_COMMAND_TYPE_SCISSOR_START: {
            // the clip's scene goes inside whatever is current — the root, or a group's scene, which then clips with the
            // rest of the subtree — and SCISSOR_END goes back to it
            Tvg_Paint clip = tvg_shape_new();
            tvg_shape_append_rect(clip, x, y, w, h, 0, 0, true);
            Tvg_Paint parent = into;
            // ponytail: eight nested clip elements; a ninth is clamped, its scene going into the root as before
            if (clipDepth == CLAY_THORVG_MAX_SCISSORS) clipDepth--, parent = root;
            clipParent[clipDepth++] = parent;
            const int level = clipDepth - 1;
            // the clip's own box in device pixels, for the dither: a gradient scrolled out of a feed must not be stippled
            // over the page above it. The clip's coordinates are the current scene's, so the groups' map applies. Inside a
            // rotated group the drawn clip turns with its scene, so the quad it maps to is what the dither cuts to: the
            // rect is that quad's bounding box (the scan) and the quad itself is tested a pixel at a time.
            const float xs[4] = {x, x + w, x + w, x}, ys[4] = {y, y, y + h, y + h};
            for (int k = 0; k < 4; k++) {
                clipStack[level].qx[k] = Clay_ThorVG_MapX(&map, xs[k], ys[k]) * d->scale;
                clipStack[level].qy[k] = Clay_ThorVG_MapY(&map, xs[k], ys[k]) * d->scale;
            }
            if (map.turn) {
                float lo[2] = {1e30f, 1e30f}, hi[2] = {-1e30f, -1e30f};
                for (int k = 0; k < 4; k++) {
                    lo[0] = fminf(lo[0], clipStack[level].qx[k]), hi[0] = fmaxf(hi[0], clipStack[level].qx[k]);
                    lo[1] = fminf(lo[1], clipStack[level].qy[k]), hi[1] = fmaxf(hi[1], clipStack[level].qy[k]);
                }
                clipStack[level].rect[0] = (int)ceilf(lo[0]);
                clipStack[level].rect[1] = (int)ceilf(lo[1]);
                clipStack[level].rect[2] = (int)floorf(hi[0]);
                clipStack[level].rect[3] = (int)floorf(hi[1]);
            } else {
                clipStack[level].rect[0] = (int)ceilf((map.xx * x + map.tx) * d->scale);
                clipStack[level].rect[1] = (int)ceilf((map.yy * y + map.ty) * d->scale);
                clipStack[level].rect[2] = (int)floorf((map.xx * (x + w) + map.tx) * d->scale);
                clipStack[level].rect[3] = (int)floorf((map.yy * (y + h) + map.ty) * d->scale);
            }
            clipStack[level].turned = map.turn;
            clipStack[clipDepth].turned = map.turn;
            into = tvg_scene_new();
            tvg_paint_set_clip(into, clip);
            tvg_scene_add(parent, into);
        } break;
        case CLAY_RENDER_COMMAND_TYPE_SCISSOR_END: into = clipDepth ? clipParent[--clipDepth] : root; break;
        case CLAY_RENDER_COMMAND_TYPE_IMAGE: {
            // imageData is the path of the picture (Clay's image config is that pointer alone), loaded once per path;
            // the command's box is where it goes, and ThorVG scales the picture into it
            Tvg_Paint picture = Clay_ThorVG_Picture(d, rcmd->renderData.image.imageData);
            if (!picture) break;
            Tvg_Paint p = tvg_paint_duplicate(picture);
            tvg_picture_set_size(p, w, h);
            tvg_paint_translate(p, x, y);
            tvg_scene_add(into, p);
        } break;
        default: SDL_Log("Unknown render command type: %d", rcmd->commandType);
        }
        // a group ends at the last command of its subtree: the scene is composited (opacity, scale) into the scene that
        // was current when it opened — a group's own border comes after its children, so this is its last command
        while (openCount && openSpan[openCount - 1]->end <= i) {
            --openCount;
            Clay_ThorVG_SettleGroup(openSpan[openCount], openScene[openCount]);
            into = openParent[openCount];
            map = openMap[openCount];
        }
    }
    // a range that never met its end (only possible with a hand-made command array) is composite as it is
    while (openCount) {
        --openCount;
        Clay_ThorVG_SettleGroup(openSpan[openCount], openScene[openCount]);
        into = openParent[openCount];
        map = openMap[openCount];
    }
    tvg_canvas_add(d->canvas, root);
    // the second pass overdraws the first: it must not clear what the blur left there
    tvg_canvas_draw(d->canvas, d->cut ? false : d->clear);
    if (tvg_canvas_sync(d->canvas) != TVG_RESULT_SUCCESS) return false;
    // ... and last, in the buffer: the gradients' banding, where nothing but the raster is left to fix it
    Clay_ThorVG_DitherGradients(d);
    return true;
}
