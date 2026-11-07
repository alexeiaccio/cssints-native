// The frame as JSON: see clay_dump.h for the schema and what a host without an effect table passes. Included by the
// hosts that dump a frame (solid/native/ui.c, desktop/host.c, browser/page.c), as they include the renderers.
#include "clay_dump.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// JSON's number for a Clay float: nine significant digits round-trips a float32 exactly, so nothing is rounded on the
// way out and a golden compares an exact value. -0 prints as -0 (two frames, as a frame hash treats them).
#define JNUM "%.9g"

// A growing buffer: a write is a short format or a literal, and a text's bytes are copied as they are.
typedef struct {
    char *bytes;
    int length, cap, failed;
} Buf;

static void reserve(Buf *b, int n)
{
    if (b->failed || b->length + n <= b->cap) return;
    int cap = b->cap ? b->cap : 4096;
    while (cap < b->length + n) cap *= 2;
    char *p = realloc(b->bytes, (size_t)cap);
    if (!p) {
        b->failed = 1;
        return;
    }
    b->bytes = p, b->cap = cap;
}

static void raw(Buf *b, const char *s, int n)
{
    reserve(b, n);
    if (b->failed) return;
    memcpy(b->bytes + b->length, s, (size_t)n);
    b->length += n;
}

static void lit(Buf *b, const char *s) { raw(b, s, (int)strlen(s)); }

static void put(Buf *b, const char *fmt, ...)
{
    char tmp[256];
    va_list args;
    va_start(args, fmt);
    const int n = vsnprintf(tmp, sizeof tmp, fmt, args);
    va_end(args);
    if (n < 0) {
        b->failed = 1;
        return;
    }
    // a string longer than the stack's (a page's text): formatted again into its own buffer
    if (n >= (int)sizeof tmp) {
        char *big = malloc((size_t)n + 1);
        if (!big) {
            b->failed = 1;
            return;
        }
        va_start(args, fmt);
        vsnprintf(big, (size_t)n + 1, fmt, args);
        va_end(args);
        raw(b, big, n);
        free(big);
        return;
    }
    raw(b, tmp, n);
}

// a JSON string: quotes, backslashes and the control characters escaped; UTF-8 passes through (a page's ², °, · and —
// are the page's own bytes)
static void json_text(Buf *b, const char *s, int len)
{
    lit(b, "\"");
    for (int i = 0; i < len; i++) {
        const unsigned char c = (unsigned char)s[i];
        if (c == '"' || c == '\\') put(b, "\\%c", c);
        else if (c < 0x20) put(b, "\\u%04x", c);
        else put(b, "%c", c);
    }
    lit(b, "\"");
}

static const char *name_of(const ClayDumpFrame *frame, uint32_t id)
{
    for (int i = 0; frame->names && i < frame->nameCount; i++)
        if (frame->names[i].id == id) return frame->names[i].name;
    return NULL;
}

/** `"id":n,"element":"the page's id"`, the name resolved from the id's hash (null for an element without one). */
static void json_element(Buf *b, const ClayDumpFrame *frame, uint32_t id)
{
    put(b, "\"id\":%u,\"element\":", id);
    const char *name = name_of(frame, id);
    if (name) json_text(b, name, (int)strlen(name));
    else lit(b, "null");
}

static void json_color(Buf *b, Clay_Color c)
{
    put(b, "[" JNUM "," JNUM "," JNUM "," JNUM "]", c.r, c.g, c.b, c.a);
}

static void json_corners(Buf *b, Clay_CornerRadius c)
{
    put(b, "[" JNUM "," JNUM "," JNUM "," JNUM "]", c.topLeft, c.topRight, c.bottomRight, c.bottomLeft);
}

static void json_box(Buf *b, Clay_BoundingBox box)
{
    put(b, "[" JNUM "," JNUM "," JNUM "," JNUM "]", box.x, box.y, box.width, box.height);
}

static const char *command_type_name(Clay_RenderCommandType t)
{
    switch (t) {
    case CLAY_RENDER_COMMAND_TYPE_RECTANGLE: return "rectangle";
    case CLAY_RENDER_COMMAND_TYPE_BORDER: return "border";
    case CLAY_RENDER_COMMAND_TYPE_TEXT: return "text";
    case CLAY_RENDER_COMMAND_TYPE_IMAGE: return "image";
    case CLAY_RENDER_COMMAND_TYPE_SCISSOR_START: return "scissor-start";
    case CLAY_RENDER_COMMAND_TYPE_SCISSOR_END: return "scissor-end";
    case CLAY_RENDER_COMMAND_TYPE_OVERLAY_COLOR_START: return "overlay-color-start";
    case CLAY_RENDER_COMMAND_TYPE_OVERLAY_COLOR_END: return "overlay-color-end";
    case CLAY_RENDER_COMMAND_TYPE_CUSTOM: return "custom";
    default: return "none";
    }
}

static const char *align_name(unsigned a)
{
    return a == CLAY_TEXT_ALIGN_CENTER ? "center" : a == CLAY_TEXT_ALIGN_RIGHT ? "right" : "left";
}

static const char *wrap_name(unsigned w)
{
    return w == CLAY_TEXT_WRAP_NEWLINES ? "newlines" : w == CLAY_TEXT_WRAP_NONE ? "none" : "words";
}

/** A node's text alignment and wrap, as its `ui_text` recorded them; Clay's zero (left, words) without a table. */
static unsigned node_field(const unsigned char *fields, int count, int32_t node)
{
    return fields && node >= 0 && node < count ? fields[node] : 0;
}

static void dump_commands(Buf *b, const ClayDumpFrame *frame)
{
    for (int32_t i = 0; i < frame->commands.length; i++) {
        const Clay_RenderCommand *c = &frame->commands.internalArray[i];
        put(b, "{\"type\":\"%s\",", command_type_name(c->commandType));
        json_element(b, frame, c->id);
        lit(b, ",\"box\":");
        json_box(b, c->boundingBox);
        put(b, ",\"z\":%d", (int)c->zIndex);
        switch (c->commandType) {
        case CLAY_RENDER_COMMAND_TYPE_RECTANGLE:
            lit(b, ",\"color\":");
            json_color(b, c->renderData.rectangle.backgroundColor);
            lit(b, ",\"radii\":");
            json_corners(b, c->renderData.rectangle.cornerRadius);
            break;
        case CLAY_RENDER_COMMAND_TYPE_BORDER: {
            const Clay_BorderRenderData *d = &c->renderData.border;
            lit(b, ",\"color\":");
            json_color(b, d->color);
            lit(b, ",\"radii\":");
            json_corners(b, d->cornerRadius);
            put(b, ",\"widths\":[%d,%d,%d,%d,%d]", (int)d->width.left, (int)d->width.right, (int)d->width.top,
                (int)d->width.bottom, (int)d->width.betweenChildren);
            break;
        }
        case CLAY_RENDER_COMMAND_TYPE_TEXT: {
            const Clay_TextRenderData *t = &c->renderData.text;
            // alignment and wrap are the text's config, not its command: the node the host recorded them on
            const int32_t node = c->userData ? (int32_t)(uintptr_t)c->userData - 1 : -1;
            lit(b, ",\"text\":");
            json_text(b, t->stringContents.chars, (int)t->stringContents.length);
            lit(b, ",\"color\":");
            json_color(b, t->textColor);
            put(b, ",\"font\":%d,\"size\":%d,\"letterSpacing\":%d,\"lineHeight\":%d", (int)t->fontId, (int)t->fontSize,
                (int)t->letterSpacing, (int)t->lineHeight);
            put(b, ",\"align\":\"%s\",\"wrap\":\"%s\"",
                align_name(node_field(frame->textAlign, frame->nodeCount, node)),
                wrap_name(node_field(frame->textWrap, frame->nodeCount, node)));
            break;
        }
        case CLAY_RENDER_COMMAND_TYPE_IMAGE: {
            const char *image = c->renderData.image.imageData;
            lit(b, ",\"path\":");
            if (image) json_text(b, image, (int)strlen(image));
            else lit(b, "null");
            lit(b, ",\"color\":");
            json_color(b, c->renderData.image.backgroundColor);
            lit(b, ",\"radii\":");
            json_corners(b, c->renderData.image.cornerRadius);
            break;
        }
        case CLAY_RENDER_COMMAND_TYPE_SCISSOR_START:
        case CLAY_RENDER_COMMAND_TYPE_SCISSOR_END: {
            const int across = c->renderData.clip.horizontal, down = c->renderData.clip.vertical;
            lit(b, ",\"axes\":[");
            if (across) lit(b, "\"horizontal\"");
            if (across && down) lit(b, ",");
            if (down) lit(b, "\"vertical\"");
            lit(b, "]");
            break;
        }
        case CLAY_RENDER_COMMAND_TYPE_OVERLAY_COLOR_START:
        case CLAY_RENDER_COMMAND_TYPE_OVERLAY_COLOR_END:
            lit(b, ",\"color\":");
            json_color(b, c->renderData.overlayColor.color);
            break;
        case CLAY_RENDER_COMMAND_TYPE_CUSTOM:
            lit(b, ",\"color\":");
            json_color(b, c->renderData.custom.backgroundColor);
            lit(b, ",\"radii\":");
            json_corners(b, c->renderData.custom.cornerRadius);
            // a custom's data is a pointer: an address is the one field of a dump the process decides, not the page
            put(b, ",\"pointer\":%llu", (unsigned long long)(uintptr_t)c->renderData.custom.customData);
            break;
        default: break;
        }
        lit(b, i + 1 < frame->commands.length ? "},\n" : "}\n");
    }
}

/** One table entry a line, as the Solid host has always written them. */
static void lit_entry_start(Buf *b, int k) { lit(b, k ? ",\n" : "\n"); }

static void dump_shadows(Buf *b, const ClayDumpFrame *frame)
{
    lit(b, ",\"shadows\":[");
    for (int k = 0; k < frame->shadowCount; k++) {
        lit_entry_start(b, k);
        lit(b, "{");
        json_element(b, frame, frame->shadows[k].id);
        put(b, ",\"x\":" JNUM ",\"y\":" JNUM ",\"blur\":" JNUM ",\"color\":", (double)frame->shadows[k].x,
            (double)frame->shadows[k].y, (double)frame->shadows[k].blur);
        json_color(b, frame->shadows[k].color);
        lit(b, "}");
    }
    lit(b, "]");
}

static void dump_backdrops(Buf *b, const ClayDumpFrame *frame)
{
    lit(b, ",\"backdrops\":[");
    for (int k = 0; k < frame->backdropCount; k++) {
        lit_entry_start(b, k);
        lit(b, "{");
        json_element(b, frame, frame->backdrops[k].id);
        put(b, ",\"blur\":" JNUM, (double)frame->backdrops[k].blur);
        lit(b, "}");
    }
    lit(b, "]");
}

static void dump_gradients(Buf *b, const ClayDumpFrame *frame)
{
    lit(b, ",\"gradients\":[");
    for (int k = 0; k < frame->gradientCount; k++) {
        const ClayDumpGradient *g = &frame->gradients[k];
        const int count = g->count > CLAY_DUMP_MAX_STOPS ? CLAY_DUMP_MAX_STOPS : g->count;
        lit_entry_start(b, k);
        lit(b, "{");
        json_element(b, frame, g->id);
        put(b, ",\"kind\":%d,\"angle\":" JNUM ",\"alpha\":%d,\"stops\":[", g->kind, (double)g->angle, g->alpha);
        for (int s = 0; s < count; s++) {
            put(b, "%s{\"offset\":" JNUM ",\"color\":", s ? "," : "", (double)g->offset[s]);
            json_color(b, g->color[s]);
            lit(b, "}");
        }
        lit(b, "]}");
    }
    lit(b, "]");
}

static void dump_groups(Buf *b, const ClayDumpFrame *frame)
{
    lit(b, ",\"groups\":[");
    for (int k = 0, written = 0; k < frame->groupCount; k++) {
        const ClayDumpGroup *g = &frame->groups[k];
        // a neutral group makes no scene and the frame's hash skips it: the dump does too, so a golden sees a frame's
        // change
        if (g->alpha >= 255 && g->scale == 1 && g->tx == 0 && g->ty == 0 && g->rotate == 0) continue;
        lit_entry_start(b, written++);
        put(b, "{\"node\":%d,\"element\":", (int)g->at);
        const uint32_t id = g->at >= 0 && g->at < frame->nodeCount ? frame->nodeIds[g->at] : 0;
        const char *name = name_of(frame, id);
        if (name) json_text(b, name, (int)strlen(name));
        else lit(b, "null");
        put(b, ",\"alpha\":%d,\"scale\":" JNUM ",\"tx\":" JNUM ",\"ty\":" JNUM ",\"rotate\":" JNUM, g->alpha,
            (double)g->scale, (double)g->tx, (double)g->ty, (double)g->rotate);
        lit(b, "}");
    }
    lit(b, "]");
}

ClayDump Clay_DumpFrame(const ClayDumpFrame *frame)
{
    Buf b = {0};
    put(&b, "{\"size\":[%d,%d],\"scale\":" JNUM ",\"hash\":\"%016llx\",\"commands\":[\n", frame->width, frame->height,
        (double)frame->scale, (unsigned long long)frame->hash);
    dump_commands(&b, frame);
    put(&b, "],\"effects\":{\"textWeight\":" JNUM, (double)frame->textWeight);
    dump_shadows(&b, frame);
    dump_backdrops(&b, frame);
    dump_gradients(&b, frame);
    dump_groups(&b, frame);
    lit(&b, "}}\n"); // the effects and the frame; each table closed its own array
    // the NUL is the buffer's, past the length
    reserve(&b, 1);
    if (b.failed) {
        free(b.bytes);
        return (ClayDump){NULL, 0};
    }
    b.bytes[b.length] = '\0';
    return (ClayDump){b.bytes, b.length};
}

void Clay_DumpFree(ClayDump dump) { free(dump.bytes); }
