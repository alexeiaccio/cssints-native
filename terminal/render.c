#include "render.h"

#include <math.h>

typedef struct {
    int x0, y0, x1, y1;
} Rect;

#define CLIP_STACK 8

static Rect clip_stack[CLIP_STACK];
static int clip_depth;
static int ignored_images, ignored_custom, ignored_other;

static Rect isect(Rect a, Rect b)
{
    return (Rect){a.x0 > b.x0 ? a.x0 : b.x0, a.y0 > b.y0 ? a.y0 : b.y0, a.x1 < b.x1 ? a.x1 : b.x1,
                  a.y1 < b.y1 ? a.y1 : b.y1};
}

// The cells a box covers: the cell its near edge is in to the cell its far edge is in. Both edges floor, so two
// boxes that meet at a cell boundary never share a cell (a fill cannot bleed into the row below); a box thinner than
// a cell still covers the one it starts in. A terminal quantises; this is the quantiser.
static Rect to_cells(Clay_BoundingBox b)
{
    Rect r = {(int)floorf(b.x / CELL_W), (int)floorf(b.y / CELL_H), (int)floorf((b.x + b.width) / CELL_W),
              (int)floorf((b.y + b.height) / CELL_H)};
    if (r.x1 <= r.x0) r.x1 = r.x0 + 1;
    if (r.y1 <= r.y0) r.y1 = r.y0 + 1;
    return r;
}

static uint8_t color(Cells *g, Clay_Color c)
{
    return cells_color(g, c.r, c.g, c.b);
}

void term_render(Cells *g, Clay_RenderCommandArray *cmds)
{
    Rect clip = {0, 0, g->cols, g->rows};
    clip_depth = 0;
    ignored_images = ignored_custom = ignored_other = 0;
    cells_clip(g, clip.x0, clip.y0, clip.x1, clip.y1);

    for (int32_t i = 0; i < cmds->length; i++) {
        Clay_RenderCommand *cmd = &cmds->internalArray[i];
        switch (cmd->commandType) {
        case CLAY_RENDER_COMMAND_TYPE_RECTANGLE: {
            const Clay_Color c = cmd->renderData.rectangle.backgroundColor;
            if (c.a == 0) break; // transparent: draws nothing, as a renderer with blending would
            const Rect r = isect(to_cells(cmd->boundingBox), clip);
            cells_fill(g, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, color(g, c));
        } break;
        case CLAY_RENDER_COMMAND_TYPE_BORDER: {
            const Clay_BorderRenderData *b = &cmd->renderData.border;
            const Clay_BorderWidth w = b->width;
            const int sides = (w.top > 0 ? CELLS_TOP : 0) | (w.right > 0 ? CELLS_RIGHT : 0) |
                              (w.bottom > 0 ? CELLS_BOTTOM : 0) | (w.left > 0 ? CELLS_LEFT : 0);
            if (!sides) break;
            const Rect r = isect(to_cells(cmd->boundingBox), clip);
            if (r.x1 <= r.x0 || r.y1 <= r.y0) break;
            cells_box(g, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, color(g, b->color), sides);
        } break;
        case CLAY_RENDER_COMMAND_TYPE_TEXT: {
            const Clay_TextRenderData *t = &cmd->renderData.text;
            g->fg = color(g, t->textColor);
            cells_put(g, (int)floorf(cmd->boundingBox.x / CELL_W), (int)floorf(cmd->boundingBox.y / CELL_H),
                      t->stringContents.chars, t->stringContents.length);
        } break;
        case CLAY_RENDER_COMMAND_TYPE_SCISSOR_START: {
            // Clay asks for one axis or both (a horizontal scroll container clips x only)
            const Clay_ClipRenderData *c = &cmd->renderData.clip;
            Rect r = to_cells(cmd->boundingBox);
            if (!c->horizontal) r.x0 = clip.x0, r.x1 = clip.x1;
            if (!c->vertical) r.y0 = clip.y0, r.y1 = clip.y1;
            if (clip_depth < CLIP_STACK) clip_stack[clip_depth] = clip;
            clip_depth++;
            clip = isect(r, clip);
            cells_clip(g, clip.x0, clip.y0, clip.x1, clip.y1);
        } break;
        case CLAY_RENDER_COMMAND_TYPE_SCISSOR_END:
            if (clip_depth > 0) clip = clip_stack[--clip_depth];
            cells_clip(g, clip.x0, clip.y0, clip.x1, clip.y1);
            break;
        case CLAY_RENDER_COMMAND_TYPE_IMAGE: ignored_images++; break;
        case CLAY_RENDER_COMMAND_TYPE_CUSTOM: ignored_custom++; break;
        case CLAY_RENDER_COMMAND_TYPE_NONE: break;
        default: ignored_other++; break;
        }
    }
}

void term_render_report(void)
{
    if (ignored_images || ignored_custom || ignored_other)
        fprintf(stderr, "terminal: ignored %d image, %d custom and %d other commands\n", ignored_images,
                ignored_custom, ignored_other);
}
