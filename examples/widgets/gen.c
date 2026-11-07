// The Widgets page's generated C through Clay (generator/page-to-c.ts), dumped as JSON one state a file after
// desktop/clay_dump.c's schema: the frame a C host of the page emits, for the Solid page's own frame at the same state
// (dump-check.ts compares them; solid-dump.ts writes the reference).
//
//   gen <out dir>          rest.json, switch.json, disclosure.json (and each state's command count)
//
// The three files are the same page at its three states: page_generated.c (the page at rest), page_generated_switch.c
// (the switch focused and on) and page_generated_disclosure.c (that, and the Details panel open). Each is one static
// frame, so the page has no motion: a state is a script of the parts' own handlers — a press on a row (its onPress, the
// focus manager) and a click (its part's `press`, which flips the signal) — replayed by examples/widgets/states.json.
//
// Text is measured with ThorVG, as the Solid host measures it (solid/native/ui.c's Clay_ThorVG_MeasureText, which
// desktop/clay_renderer_thorvg.c holds): the playback of a glyph's advances is the same sum, so a box is the golden's
// exact number, not a tolerance. The dump has no names (a C page keeps no id strings; dump-check.ts resolves them from
// the Solid frame) and no effect tables (the page has none).
#define CLAY_IMPLEMENTATION
#include "clay.h"

#include <thorvg_capi.h>

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../../desktop/clay_dump.c"

#ifndef FONT_PATH
#define FONT_PATH "vendor/fonts/Roboto-Regular.ttf"
#endif

// the page's size (solid/app/Widgets.tsx's `size`)
#define APP_W 360
#define APP_H 760

void app_frame_rest(void);
void app_frame_switch(void);
void app_frame_disclosure(void);

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

/** One state's frame as JSON at `<dir>/<name>.json`: the commands, and empty effect tables. */
static int dump(const char *dir, const char *name, void (*frame)(void))
{
    Clay_BeginLayout();
    frame();
    const Clay_RenderCommandArray commands = Clay_EndLayout(0);
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
    printf("%s: %d commands\n", name, commands.length);
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
    failed |= dump(dir, "rest", app_frame_rest);
    failed |= dump(dir, "switch", app_frame_switch);
    failed |= dump(dir, "disclosure", app_frame_disclosure);
    return failed;
}
