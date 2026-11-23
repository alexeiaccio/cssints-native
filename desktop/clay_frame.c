// Two frames as one value: whether they are the same, and the box they differ in. A frame is a Clay command array; a
// host draws it only when it differs from the one on screen, and uploads only the rectangle the difference lives in.
//
// Text is compared by its bytes, not by its pointer: a page may format into a buffer it reuses (ui.c's arena, a page's
// own scratch), so the previous frame's slice points at *this* frame's text unless the bytes were copied with the frame.
// Clay_FrameSave copies them; Clay_FrameDiff reads only its own copy against the live frame.
//
// The box is the union of the bounding boxes of the commands that differ, on both sides: a command that moved covers
// where it was and where it is. It is the lazy shape of damage — one rectangle, no region list — and it is only ever
// too big, never too small, because a command's box is where its pixels are.

#include <math.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    int32_t x, y, w, h;
} Clay_FrameBox; // w or h <= 0: empty

typedef struct {
    Clay_RenderCommand *commands; // the last frame's commands, ours
    int32_t count, capacity;
    char *text; // the text the copy's slices point into
    int32_t textLength, textCapacity;
} Clay_Frame;

static bool Clay_FrameBoxEmpty(Clay_FrameBox b) { return b.w <= 0 || b.h <= 0; }

static Clay_FrameBox Clay_FrameBoxOf(Clay_BoundingBox b)
{
    const int32_t x0 = (int32_t)floorf(b.x), y0 = (int32_t)floorf(b.y);
    const int32_t x1 = (int32_t)ceilf(b.x + b.width), y1 = (int32_t)ceilf(b.y + b.height);
    return (Clay_FrameBox){x0, y0, x1 - x0, y1 - y0};
}

static Clay_FrameBox Clay_FrameBoxUnion(Clay_FrameBox a, Clay_FrameBox b)
{
    if (Clay_FrameBoxEmpty(a)) return b;
    if (Clay_FrameBoxEmpty(b)) return a;
    const int32_t x0 = a.x < b.x ? a.x : b.x, y0 = a.y < b.y ? a.y : b.y;
    const int32_t x1 = a.x + a.w > b.x + b.w ? a.x + a.w : b.x + b.w;
    const int32_t y1 = a.y + a.h > b.y + b.h ? a.y + a.h : b.y + b.h;
    return (Clay_FrameBox){x0, y0, x1 - x0, y1 - y0};
}

/** The whole target as a box: what a frame with no previous one, or one that cannot be diffed, damages. */
static Clay_FrameBox Clay_FrameBoxAll(int32_t width, int32_t height) { return (Clay_FrameBox){0, 0, width, height}; }

/** A frame's box in the target's device pixels: scaled, a pixel wider on every side for the antialiasing at its edge,
 *  and cut to the target. Empty stays empty (the whole target). */
static Clay_FrameBox Clay_FrameBoxScaled(Clay_FrameBox box, float scale, int32_t width, int32_t height)
{
    if (Clay_FrameBoxEmpty(box)) return (Clay_FrameBox){0, 0, 0, 0};
    int32_t x0 = (int32_t)floorf(box.x * scale) - 1, y0 = (int32_t)floorf(box.y * scale) - 1;
    int32_t x1 = (int32_t)ceilf((box.x + box.w) * scale) + 1, y1 = (int32_t)ceilf((box.y + box.h) * scale) + 1;
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > width) x1 = width;
    if (y1 > height) y1 = height;
    if (x1 <= x0 || y1 <= y0) return (Clay_FrameBox){0, 0, 0, 0};
    return (Clay_FrameBox){x0, y0, x1 - x0, y1 - y0};
}

// A float by its bits: two frames whose boxes differ in the last mantissa bit are two frames.
static bool Clay_FrameFloatSame(float a, float b) { return memcmp(&a, &b, sizeof a) == 0; }

static bool Clay_FrameColorSame(Clay_Color a, Clay_Color b)
{
    return Clay_FrameFloatSame(a.r, b.r) && Clay_FrameFloatSame(a.g, b.g) && Clay_FrameFloatSame(a.b, b.b) &&
           Clay_FrameFloatSame(a.a, b.a);
}

static bool Clay_FrameCornersSame(Clay_CornerRadius a, Clay_CornerRadius b)
{
    return Clay_FrameFloatSame(a.topLeft, b.topLeft) && Clay_FrameFloatSame(a.topRight, b.topRight) &&
           Clay_FrameFloatSame(a.bottomLeft, b.bottomLeft) && Clay_FrameFloatSame(a.bottomRight, b.bottomRight);
}

static bool Clay_FrameBoxSame(Clay_BoundingBox a, Clay_BoundingBox b)
{
    return Clay_FrameFloatSame(a.x, b.x) && Clay_FrameFloatSame(a.y, b.y) &&
           Clay_FrameFloatSame(a.width, b.width) && Clay_FrameFloatSame(a.height, b.height);
}

static bool Clay_FrameSliceSame(Clay_StringSlice a, Clay_StringSlice b)
{
    return a.length == b.length && (a.length == 0 || memcmp(a.chars, b.chars, (size_t)a.length) == 0);
}

/** Whether two commands draw the same pixels: every field a renderer reads, and text by its bytes. */
static bool Clay_FrameCommandSame(const Clay_RenderCommand *a, const Clay_RenderCommand *b)
{
    if (a->commandType != b->commandType || a->id != b->id || a->zIndex != b->zIndex ||
        a->userData != b->userData || !Clay_FrameBoxSame(a->boundingBox, b->boundingBox))
        return false;
    switch (a->commandType) {
    case CLAY_RENDER_COMMAND_TYPE_RECTANGLE:
        return Clay_FrameColorSame(a->renderData.rectangle.backgroundColor, b->renderData.rectangle.backgroundColor) &&
               Clay_FrameCornersSame(a->renderData.rectangle.cornerRadius, b->renderData.rectangle.cornerRadius);
    case CLAY_RENDER_COMMAND_TYPE_TEXT:
        return Clay_FrameSliceSame(a->renderData.text.stringContents, b->renderData.text.stringContents) &&
               Clay_FrameColorSame(a->renderData.text.textColor, b->renderData.text.textColor) &&
               a->renderData.text.fontId == b->renderData.text.fontId &&
               a->renderData.text.fontSize == b->renderData.text.fontSize &&
               a->renderData.text.letterSpacing == b->renderData.text.letterSpacing &&
               a->renderData.text.lineHeight == b->renderData.text.lineHeight;
    case CLAY_RENDER_COMMAND_TYPE_IMAGE:
        return Clay_FrameColorSame(a->renderData.image.backgroundColor, b->renderData.image.backgroundColor) &&
               Clay_FrameCornersSame(a->renderData.image.cornerRadius, b->renderData.image.cornerRadius) &&
               a->renderData.image.imageData == b->renderData.image.imageData;
    case CLAY_RENDER_COMMAND_TYPE_CUSTOM:
        return Clay_FrameColorSame(a->renderData.custom.backgroundColor, b->renderData.custom.backgroundColor) &&
               Clay_FrameCornersSame(a->renderData.custom.cornerRadius, b->renderData.custom.cornerRadius) &&
               a->renderData.custom.customData == b->renderData.custom.customData;
    case CLAY_RENDER_COMMAND_TYPE_BORDER:
        return Clay_FrameColorSame(a->renderData.border.color, b->renderData.border.color) &&
               Clay_FrameCornersSame(a->renderData.border.cornerRadius, b->renderData.border.cornerRadius) &&
               a->renderData.border.width.left == b->renderData.border.width.left &&
               a->renderData.border.width.right == b->renderData.border.width.right &&
               a->renderData.border.width.top == b->renderData.border.width.top &&
               a->renderData.border.width.bottom == b->renderData.border.width.bottom &&
               a->renderData.border.width.betweenChildren == b->renderData.border.width.betweenChildren;
    case CLAY_RENDER_COMMAND_TYPE_SCISSOR_START:
    case CLAY_RENDER_COMMAND_TYPE_SCISSOR_END:
        return a->renderData.clip.horizontal == b->renderData.clip.horizontal &&
               a->renderData.clip.vertical == b->renderData.clip.vertical;
    case CLAY_RENDER_COMMAND_TYPE_OVERLAY_COLOR_START:
    case CLAY_RENDER_COMMAND_TYPE_OVERLAY_COLOR_END:
        return Clay_FrameColorSame(a->renderData.overlayColor.color, b->renderData.overlayColor.color);
    default:
        return true; // NONE, and a type a newer Clay adds: the box and the id are all we know
    }
}

/** Keeps a frame as the one to compare the next with: its commands, and a copy of the text they point at. */
static void Clay_FrameSave(Clay_Frame *f, Clay_RenderCommandArray *cmds)
{
    if (f->capacity < cmds->length) {
        const int32_t capacity = cmds->length < 16 ? 16 : cmds->length;
        Clay_RenderCommand *grown = realloc(f->commands, (size_t)capacity * sizeof *grown);
        if (!grown) return; // no copy: the next frame is a full one, never a skipped one
        f->commands = grown, f->capacity = capacity;
    }
    int32_t text = 0;
    for (int32_t i = 0; i < cmds->length; i++)
        if (cmds->internalArray[i].commandType == CLAY_RENDER_COMMAND_TYPE_TEXT)
            text += cmds->internalArray[i].renderData.text.stringContents.length;
    if (f->textCapacity < text) {
        const int32_t capacity = text < 256 ? 256 : text;
        char *grown = realloc(f->text, (size_t)capacity);
        if (!grown) return;
        f->text = grown, f->textCapacity = capacity;
    }
    f->count = cmds->length;
    f->textLength = 0;
    if (cmds->length) memcpy(f->commands, cmds->internalArray, (size_t)cmds->length * sizeof *f->commands);
    for (int32_t i = 0; i < f->count; i++) {
        Clay_StringSlice *slice = &f->commands[i].renderData.text.stringContents;
        if (f->commands[i].commandType != CLAY_RENDER_COMMAND_TYPE_TEXT || slice->length <= 0) continue;
        memcpy(f->text + f->textLength, slice->chars, (size_t)slice->length);
        slice->chars = f->text + f->textLength;
        f->textLength += slice->length;
    }
}

/**
 * The box `cur` differs from the saved frame in, and whether they are the same frame at all. `same` is false with an
 * empty box when the command count changed: the caller damages the whole target then (it is the one who knows its
 * size).
 */
static Clay_FrameBox Clay_FrameDiff(Clay_Frame *f, Clay_RenderCommandArray *cur, bool *same)
{
    if (f->count != cur->length || (f->count && !f->commands)) {
        *same = false;
        return (Clay_FrameBox){0, 0, 0, 0};
    }
    Clay_FrameBox box = {0, 0, 0, 0};
    bool equal = true;
    for (int32_t i = 0; i < cur->length; i++) {
        const Clay_RenderCommand *a = &f->commands[i], *b = &cur->internalArray[i];
        if (Clay_FrameCommandSame(a, b)) continue;
        equal = false;
        box = Clay_FrameBoxUnion(box, Clay_FrameBoxOf(a->boundingBox));
        box = Clay_FrameBoxUnion(box, Clay_FrameBoxOf(b->boundingBox));
    }
    *same = equal;
    return box;
}
