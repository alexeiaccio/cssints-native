// The Text field page's generated C through Clay (generator/page-to-c.ts), dumped as JSON one state a file after
// desktop/clay_dump.c's schema: the frame a C host of the page emits, for the Solid page's own frame at the same state
// (dump-check.ts compares them; solid-dump.ts writes the reference).
//
//   gen <out dir>          empty.json, typed.json, selection.json (and each state's command count)
//
// The three files are the same page at its three states: page_generated.c (the field focused, empty), page_generated_typed.c
// (`Ada` in it) and page_generated_selection.c (`da` selected). Each is one static frame, so the page has no motion: a
// state is a script of its input — the row's press (the focus), typed text and the keys — replayed by examples/field/states.json.
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

// the page's size (solid/app/Field.tsx's `size`)
#define APP_W 360
#define APP_H 450

void app_frame_empty(void);
void app_frame_typed(void);
void app_frame_selection(void);

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

// A text's wrap cannot reach the dump from the generated declaration: Clay's text command carries no wrap, and a
// command's node is its `Clay_TextElementConfig.userData`, which the printed text configs leave NULL (the Solid host
// sets it in `ui_text`; header() prints the shape and no such field). So this file numbers the text commands itself, in
// tree order, and gives each the wrap its style has: the runs of the two field rows are the page's only
// `css.whiteSpace("nowrap")` texts and every other text is the default (words). A text added above a value shifts the
// indexes, and dump-check names the wrap difference — the table cannot go quiet.
static const unsigned char text_align[256]; // all left, the page's only alignment
static unsigned char text_wrap[256];

/** One state's frame as JSON at `<dir>/<name>.json`: the commands, and empty effect tables. `none` lists the text
 *  commands (in tree order) whose style is nowrap. */
static int dump(const char *dir, const char *name, void (*frame)(void), const int *none, int count)
{
    Clay_BeginLayout();
    frame();
    Clay_RenderCommandArray commands = Clay_EndLayout(0);
    int texts = 0;
    for (int i = 0; i < commands.length; i++)
        if (commands.internalArray[i].commandType == CLAY_RENDER_COMMAND_TYPE_TEXT)
            commands.internalArray[i].userData = (void *)(intptr_t)(++texts);
    memset(text_wrap, 0, sizeof text_wrap);
    for (int i = 0; i < count; i++) text_wrap[none[i]] = CLAY_TEXT_WRAP_NONE;
    const ClayDumpFrame f = {.commands = commands,
                             .width = APP_W,
                             .height = APP_H,
                             .scale = 1,
                             .hash = 0, // a frame hash is the Solid host's
                             .textAlign = text_align,
                             .textWrap = text_wrap,
                             .nodeCount = texts,
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
    // the value runs: the text commands of the two field rows (tree order), a state's tree as its Show's leave it
    static const int none_empty[] = {7}; // "ada@example.com"
    static const int none_typed[] = {5, 8}; // "Ada", "ada@example.com"
    static const int none_selection[] = {5, 6, 9}; // "A", "da", "ada@example.com"
    failed |= dump(dir, "empty", app_frame_empty, none_empty, (int)(sizeof none_empty / sizeof *none_empty));
    failed |= dump(dir, "typed", app_frame_typed, none_typed, (int)(sizeof none_typed / sizeof *none_typed));
    failed |= dump(dir, "selection", app_frame_selection, none_selection,
                   (int)(sizeof none_selection / sizeof *none_selection));
    return failed;
}
