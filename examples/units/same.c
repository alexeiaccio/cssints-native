// The generated pill against the one ui.c writes by hand: Clay must give the same render commands.
#define CLAY_IMPLEMENTATION
#include "styles.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const Clay_Color PANEL = {36, 40, 52, 255}, DIM = {150, 155, 170, 255};

static Clay_RenderCommandArray frame(int generated)
{
    Clay_BeginLayout();
    if (generated) {
        CLAY(CLAY_ID("Units"), units) {}
    } else {
        CLAY(CLAY_ID("Units"), {.layout = {.sizing = {CLAY_SIZING_FIXED(200), CLAY_SIZING_FIXED(38)},
                                           .childAlignment = {CLAY_ALIGN_X_CENTER, CLAY_ALIGN_Y_CENTER}},
                                .backgroundColor = PANEL,
                                .cornerRadius = CLAY_CORNER_RADIUS(19),
                                .border = {.color = DIM, .width = CLAY_BORDER_OUTSIDE(1)}}) {}
    }
    return Clay_EndLayout(0);
}

int main(void)
{
    uint32_t n = Clay_MinMemorySize();
    Clay_Initialize(Clay_CreateArenaWithCapacityAndMemory(n, malloc(n)), (Clay_Dimensions){360, 360},
                    (Clay_ErrorHandler){0});
    Clay_RenderCommandArray a = frame(0);
    int count = a.length;
    Clay_RenderCommand hand[8];
    memcpy(hand, a.internalArray, count * sizeof *hand);
    Clay_RenderCommandArray b = frame(1);
    int same = count == b.length;
    for (int i = 0; same && i < count; i++)
        same = hand[i].commandType == b.internalArray[i].commandType &&
               !memcmp(&hand[i].boundingBox, &b.internalArray[i].boundingBox, sizeof hand[i].boundingBox) &&
               !memcmp(&hand[i].renderData, &b.internalArray[i].renderData, sizeof hand[i].renderData);
    printf("%d commands, %s\n", count, same ? "identical" : "DIFFERENT");
    return !same;
}
