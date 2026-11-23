// The frame diff, on command arrays built by hand: what a host skips, and the box it uploads. No SDL, no ThorVG — the
// whole file is the Clay types and desktop/clay_frame.c, so check.sh runs it on any machine.
#include <stdio.h>
#include <string.h>

#include "clay.h"

#include "clay_frame.c"

static int failures;
static void check(bool ok, const char *what)
{
    if (!ok) failures++, fprintf(stderr, "frame: %s\n", what);
}

static Clay_RenderCommand rect(float x, float y, float w, float h, float r)
{
    Clay_RenderCommand c = {0};
    c.commandType = CLAY_RENDER_COMMAND_TYPE_RECTANGLE;
    c.boundingBox = (Clay_BoundingBox){x, y, w, h};
    c.renderData.rectangle.backgroundColor = (Clay_Color){r, 0, 0, 255};
    return c;
}

static Clay_RenderCommand text(float x, float y, char *chars, int length)
{
    Clay_RenderCommand c = {0};
    c.commandType = CLAY_RENDER_COMMAND_TYPE_TEXT;
    c.boundingBox = (Clay_BoundingBox){x, y, 40, 12};
    c.renderData.text.stringContents = (Clay_StringSlice){.length = length, .chars = chars};
    c.renderData.text.textColor = (Clay_Color){255, 255, 255, 255};
    return c;
}

int main(void)
{
    Clay_RenderCommand live[3];
    char label[16] = "11:59";
    live[0] = rect(0, 0, 100, 100, 0.1f);
    live[1] = text(4, 4, label, 5);
    live[2] = rect(10, 10, 20, 20, 0.2f);
    Clay_RenderCommandArray frame = {.capacity = 3, .length = 3, .internalArray = live};

    Clay_Frame saved = {0};
    Clay_FrameSave(&saved, &frame);
    bool same = false;
    Clay_FrameBox box = Clay_FrameDiff(&saved, &frame, &same);
    check(same && Clay_FrameBoxEmpty(box), "the same frame is the same frame");

    // one element moves: the box covers where it was and where it is, and nothing else
    live[2] = rect(10, 10, 20, 30, 0.2f);
    box = Clay_FrameDiff(&saved, &frame, &same);
    check(!same, "a taller box is a different frame");
    check(box.x == 10 && box.y == 10 && box.w == 20 && box.h == 30, "the box is the element's own");
    Clay_FrameSave(&saved, &frame);
    live[2] = rect(50, 60, 20, 30, 0.2f);
    box = Clay_FrameDiff(&saved, &frame, &same);
    check(!same && box.x == 10 && box.y == 10 && box.w == 60 && box.h == 80, "a moved element covers both places");
    Clay_FrameSave(&saved, &frame);

    // text is the bytes, and the copy keeps them: a page formatting into one buffer must not look unchanged
    memcpy(label, "12:00", 5);
    box = Clay_FrameDiff(&saved, &frame, &same);
    check(!same && box.y == 4, "a text whose bytes changed is a different frame");
    Clay_FrameSave(&saved, &frame);
    memcpy(label, "11:59", 5); // the source buffer is overwritten with the old text: the saved copy is its own
    box = Clay_FrameDiff(&saved, &frame, &same);
    check(!same, "the saved frame keeps its own text bytes");

    // a command added or dropped is a whole frame: the diff cannot say where
    frame.length = 2;
    box = Clay_FrameDiff(&saved, &frame, &same);
    check(!same && Clay_FrameBoxEmpty(box), "another command count is a whole frame");

    // a colour change inside one box is that box
    frame.length = 3;
    live[2] = rect(50, 60, 20, 30, 0.2f);
    Clay_FrameSave(&saved, &frame);
    live[0].renderData.rectangle.backgroundColor = (Clay_Color){0, 0, 1, 1};
    box = Clay_FrameDiff(&saved, &frame, &same);
    check(!same && box.x == 0 && box.y == 0 && box.w == 100 && box.h == 100, "a repainted rectangle is its box");

    free(saved.commands), free(saved.text);
    if (failures) return 1;
    printf("frame: the diff, the copy and the box are right\n");
    return 0;
}
