// The desktop's frame as data, for browser/check.mjs: Clay + the generated Sensors page, measured with SDL_ttf and
// Roboto exactly as desktop/host.c is, printed as JSON. Not part of the shipped page; it is how the expected command
// table in browser/check.mjs was produced.
#define CLAY_IMPLEMENTATION
#include "clay.h"
#include "styles.h"
#include <SDL3_ttf/SDL_ttf.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void app_frame(void);
void app_frame_g(void);
static TTF_Font *font;

static Clay_Dimensions measure(Clay_StringSlice text, Clay_TextElementConfig *config, void *user)
{
    (void)user;
    int w = 0, h = 0;
    TTF_SetFontSize(font, config->fontSize ? config->fontSize : 14);
    TTF_GetStringSize(font, text.chars, text.length, &w, &h);
    return (Clay_Dimensions){(float)w, config->lineHeight ? (float)config->lineHeight : (float)h};
}
static void on_error(Clay_ErrorData e) { fprintf(stderr, "clay error %d\n", (int)e.errorType); }
static int ch(float v) { return v <= 0 ? 0 : v >= 255 ? 255 : (int)(v + 0.5f); }

int main(int argc, char **argv)
{
    const int useG = argc > 1 && !strcmp(argv[1], "g");
    TTF_Init();
    font = TTF_OpenFont(getenv("FONT"), 20);
    if (!font) { fprintf(stderr, "FONT is not a font\n"); return 1; }
    const uint32_t needed = Clay_MinMemorySize();
    char *arena = malloc(needed);
    Clay_Initialize(Clay_CreateArenaWithCapacityAndMemory(needed, arena), (Clay_Dimensions){360, 360},
                    (Clay_ErrorHandler){on_error, 0});
    Clay_SetMeasureTextFunction(measure, 0);
    Clay_BeginLayout();
    if (useG) app_frame_g(); else app_frame();
    Clay_RenderCommandArray a = Clay_EndLayout(1.0f / 60.0f);
    printf("[\n");
    for (int32_t i = 0; i < a.length; i++) {
        Clay_RenderCommand *r = Clay_RenderCommandArray_Get(&a, i);
        printf("  {\"type\": %d, \"id\": %uu, \"x\": %.2f, \"y\": %.2f, \"w\": %.2f, \"h\": %.2f",
               (int)r->commandType, r->id, r->boundingBox.x, r->boundingBox.y, r->boundingBox.width, r->boundingBox.height);
        if (r->commandType == CLAY_RENDER_COMMAND_TYPE_TEXT) {
            Clay_TextRenderData *t = &r->renderData.text;
            printf(", \"color\": \"#%02x%02x%02x\", \"fontSize\": %d, \"text\": \"%.*s\"",
                   ch(t->textColor.r), ch(t->textColor.g), ch(t->textColor.b), (int)t->fontSize,
                   (int)t->stringContents.length, t->stringContents.chars);
        } else if (r->commandType == CLAY_RENDER_COMMAND_TYPE_RECTANGLE) {
            Clay_RectangleRenderData *d = &r->renderData.rectangle;
            printf(", \"color\": \"#%02x%02x%02x\", \"radius\": [%.0f, %.0f, %.0f, %.0f]",
                   ch(d->backgroundColor.r), ch(d->backgroundColor.g), ch(d->backgroundColor.b),
                   d->cornerRadius.topLeft, d->cornerRadius.topRight, d->cornerRadius.bottomRight,
                   d->cornerRadius.bottomLeft);
        } else if (r->commandType == CLAY_RENDER_COMMAND_TYPE_BORDER) {
            Clay_BorderRenderData *d = &r->renderData.border;
            printf(", \"color\": \"#%02x%02x%02x\", \"radius\": [%.0f, %.0f, %.0f, %.0f], \"border\": [%d, %d, %d, %d]",
                   ch(d->color.r), ch(d->color.g), ch(d->color.b),
                   d->cornerRadius.topLeft, d->cornerRadius.topRight, d->cornerRadius.bottomRight,
                   d->cornerRadius.bottomLeft, (int)d->width.left, (int)d->width.right, (int)d->width.top,
                   (int)d->width.bottom);
        }
        printf("}%s\n", i + 1 < a.length ? "," : "");
    }
    printf("]\n");
    return 0;
}
