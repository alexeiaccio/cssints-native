// The List page's generated C through Clay (generator/page-to-c.ts), dumped as JSON one state a file after
// desktop/clay_dump.c's schema: the frame a C host of the page emits, for the Solid page's own frame at the same state
// (dump-check.ts compares them; solid-dump.ts writes the reference).
//
//   gen <out dir>          rest.json (the viewport at its top), scrolled.json (one notch down, 10px)
//
// The page's offset is not a declaration. Its viewport is one clip element — `css.overflow("hidden")`, so Clay's
// `Clay_ClipElementConfig` with both axes and no `childOffset` — and the offset is the host's, exactly as on the Solid
// page (solid/native/ui.c: `d.clip.childOffset = Clay_GetScrollOffset()`): the generated file declares the element
// through `clip_scroll`, which reads Clay's own offset for it, and a C host puts the number in the container
// (`Clay_ScrollContainerData.scrollPosition`, `ui_scroll_to`'s line). So one frame is two layouts: the first creates the
// container and lays the rows out, then the host writes the offset, and the second is the frame the declaration of the
// clip element reads.
//
// The window of rows is the page's (`solid/src/virtual.ts`'s `fixedWindow`), so a file is one offset: page_generated.c is
// the page at 0 (rows 0..8), page_generated_scrolled.c at 10 (rows 0..9, one more row is in the overscan).
//
// Text is measured with ThorVG, as the Solid host measures it (solid/native/ui.c's Clay_ThorVG_MeasureText, which
// desktop/clay_renderer_thorvg.c holds): a box is the golden's exact number, not a tolerance. The dump has no names (a C
// page keeps no id strings; dump-check.ts resolves them from the Solid frame) and no effect tables (a group is no Clay
// field: the header drops them, and the page at rest has none).
#define CLAY_IMPLEMENTATION
#include "clay.h"

#include <thorvg_capi.h>

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../../desktop/clay_dump.c"

#ifndef FONT_PATH
#define FONT_PATH "vendor/fonts/Roboto-Regular.ttf"
#endif

// the page's size (solid/app/List.tsx's `size`)
#define APP_W 360
#define APP_H 400
// the viewport's id (List.tsx's VIEW) and the one notch of its test (10px)
#define VIEW "list"
#define NOTCH 10.0f

void app_frame_list(void);
void app_frame_list_scrolled(void);

static Tvg_Paint measurer;

// ThorVG's glyph advances, as the desktop's renderer sums them (desktop/clay_renderer_thorvg.c's measure): one copy, so
// the boxes are the Solid page's. A string longer than this buffer is not one of this page's.
static const char *cstring(Clay_StringSlice s)
{
    static char buf[4096];
    const int n = s.length < (int)sizeof buf - 1 ? s.length : (int)sizeof buf - 1;
    memcpy(buf, s.chars, (size_t)n);
    buf[n] = '\0';
    return buf;
}

static Clay_Dimensions measure(Clay_StringSlice text, Clay_TextElementConfig *config, void *user)
{
    (void)user;
    Tvg_Paint t = measurer;
    tvg_text_set_font(t, "Roboto-Regular");
    tvg_text_set_size(t, (config->fontSize ? config->fontSize : 14) * 0.75f); // CLAY_THORVG_PT
    float w = 0;
    for (const char *p = cstring(text); *p;) {
        Tvg_Glyph_Metrics g;
        if (tvg_text_get_glyph_metrics(t, p, &g, &p) != TVG_RESULT_SUCCESS) break;
        w += g.advance + config->letterSpacing;
    }
    Tvg_Text_Metrics m = {0};
    tvg_text_get_text_metrics(t, &m);
    return (Clay_Dimensions){w, config->lineHeight ? (float)config->lineHeight : m.advance};
}

static void on_error(Clay_ErrorData e)
{
    fprintf(stderr, "clay error %d: %.*s\n", (int)e.errorType, (int)e.errorText.length, e.errorText.chars);
    exit(1);
}

/** The frame at one viewport offset (px down): the first layout creates the container, the host writes the offset, the
 *  second is the frame the declaration's `Clay_GetScrollOffset()` makes. */
static Clay_RenderCommandArray layout_at(void (*frame)(void), float offset)
{
    Clay_BeginLayout();
    frame();
    Clay_EndLayout(0);
    const Clay_ElementId id = Clay_GetElementId(CLAY_STRING(VIEW));
    const Clay_ScrollContainerData d = Clay_GetScrollContainerData(id);
    if (!d.found) {
        fprintf(stderr, "the page has no scroll container \"" VIEW "\": the viewport's `css.overflow(\"hidden\")` was not "
                        "declared as a clip element\n");
        exit(1);
    }
    // the host's line, `ui_scroll_to`'s: the offset the page's own track writes, clamped to the container's content
    const float lowest = -fmaxf(d.contentDimensions.height - d.scrollContainerDimensions.height, 0);
    d.scrollPosition->y = fminf(fmaxf(offset, lowest), 0);
    Clay_BeginLayout();
    frame();
    return Clay_EndLayout(0);
}

/** One state's frame as JSON at `<dir>/<name>.json`: the commands, and empty effect tables. */
static int dump(const char *dir, const char *name, void (*frame)(void), float offset)
{
    const Clay_RenderCommandArray commands = layout_at(frame, offset);
    const ClayDumpFrame f = {.commands = commands,
                             .width = APP_W,
                             .height = APP_H,
                             .scale = 1,
                             .hash = 0, // a frame hash is the Solid host's
                             .textWeight = 0};
    const ClayDump dump = Clay_DumpFrame(&f);
    if (!dump.bytes) return 1;
    char path[1024];
    snprintf(path, sizeof path, "%s/%s.json", dir, name);
    FILE *out = fopen(path, "wb");
    if (!out) {
        Clay_DumpFree(dump);
        return 1;
    }
    const int wrote = fwrite(dump.bytes, 1, (size_t)dump.length, out) == (size_t)dump.length;
    Clay_DumpFree(dump);
    if (fclose(out) != 0 || !wrote) return 1;
    printf("%s: %d commands, viewport offset %.0f\n", name, commands.length, offset);
    return 0;
}

int main(int argc, char **argv)
{
    const char *dir = argc > 1 ? argv[1] : ".";
    if (tvg_engine_init(0) || tvg_font_load(FONT_PATH)) {
        fprintf(stderr, "thorvg: no engine or no font %s\n", FONT_PATH);
        return 1;
    }
    measurer = tvg_text_new();
    const uint32_t size = Clay_MinMemorySize();
    Clay_Initialize(Clay_CreateArenaWithCapacityAndMemory(size, malloc(size)), (Clay_Dimensions){APP_W, APP_H},
                    (Clay_ErrorHandler){on_error});
    Clay_SetMeasureTextFunction(measure, NULL);
    int failed = 0;
    failed |= dump(dir, "rest", app_frame_list, 0);
    failed |= dump(dir, "scrolled", app_frame_list_scrolled, -NOTCH);
    return failed;
}
