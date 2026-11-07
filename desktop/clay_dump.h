// One emitter of a frame as JSON, for every target: the Solid host (solid/native/ui.c), the C page on the desktop
// (desktop/host.c --dump) and the wasm in the browser (browser/page.c). Pure Clay and libc (malloc and vsnprintf): no
// SDL, no ThorVG, no file I/O. The bytes are returned in memory, and each host writes them the way its target can (a
// file, a buffer JS reads out of the wasm's memory).
//
// The schema is the one `ui_dump_json` wrote in solid/native/ui.c before this file: the layout's size and the raster's
// scale, then every command's fields that a draw reads (type, Clay's id and the page's id string behind it when the host
// knows one, box and z, and per type the text with its colour/font/size/spacing/line height/alignment/wrap, a rectangle's
// colour and radii, a border's colour/radii/five widths, an image's path, a clip's axes, a custom's pointer), then the
// renderer's side tables that a frame's hash folds in but no command carries (shadows, backdrops, gradients, groups and
// the text weight), and the frame's hash. A host without an effect table passes an empty one (the C page has no shadows,
// gradients or groups); a host without the page's id strings passes no names (a command's `element` is null, and a
// golden's differ resolves it by id).
#ifndef CLAY_DUMP_H
#define CLAY_DUMP_H

#include "clay.h"

#include <stdint.h>

// a gradient's stops: the renderer's own limit (css.backgroundImage)
#define CLAY_DUMP_MAX_STOPS 8

/** The page's id string of an element, by Clay's 32-bit hash of it. A host builds this table as it declares elements
 *  (solid/native/ui.c interns one per `ui_open`); a host that cannot leaves it out. */
typedef struct {
    uint32_t id;
    const char *name;
} ClayDumpName;

/** A shadow (`css.shadow`): the renderer's table, not a command. */
typedef struct {
    uint32_t id;
    float x, y, blur;
    Clay_Color color;
} ClayDumpShadow;

/** A backdrop (`css.backdrop`): the pixels under that element are blurred. */
typedef struct {
    uint32_t id;
    float blur;
} ClayDumpBackdrop;

/** A gradient (`css.backgroundImage`): kind 1 is linear, the only one cssints/clay writes. `alpha` 255 is the gradient
 *  alone; below it, composited over the box's solid fill. */
typedef struct {
    uint32_t id;
    int kind;
    float angle;
    int alpha;
    int count;
    float offset[CLAY_DUMP_MAX_STOPS];
    Clay_Color color[CLAY_DUMP_MAX_STOPS];
} ClayDumpGradient;

/** One element's subtree as a scene: alpha, scale, visual offset and rotation (the value channel's 46..49 and 55). */
typedef struct {
    int32_t at; // the element's node in the frame's tree
    int alpha;
    float scale, tx, ty, rotate;
} ClayDumpGroup;

/** One frame, as a host has it after `Clay_EndLayout`. */
typedef struct {
    Clay_RenderCommandArray commands;
    int width, height;
    float scale;
    /** The frame's hash (`ui_hash`), or 0 for a host that does not hash its frames. */
    uint64_t hash;
    /** The page's id strings, by Clay id; NULL when the host has no such table. */
    const ClayDumpName *names;
    int nameCount;
    /** Each node's Clay id, by node (a command's `userData` - 1), for a group's element; NULL without groups. */
    const uint32_t *nodeIds;
    int nodeCount;
    /** Each node's text alignment and wrap, by node: Clay's text command carries neither. NULL (or a node past
     *  `nodeCount`) is Clay's own zero: left, words. */
    const unsigned char *textAlign;
    const unsigned char *textWrap;
    float textWeight;
    const ClayDumpShadow *shadows;
    int shadowCount;
    const ClayDumpBackdrop *backdrops;
    int backdropCount;
    const ClayDumpGradient *gradients;
    int gradientCount;
    const ClayDumpGroup *groups;
    int groupCount;
} ClayDumpFrame;

/** The frame as JSON. `bytes` is malloc'd and NUL-terminated (its length does not count the NUL); `length` is 0 when the
 *  allocation failed. Free it with Clay_DumpFree. */
typedef struct {
    char *bytes;
    int length;
} ClayDump;

ClayDump Clay_DumpFrame(const ClayDumpFrame *frame);
void Clay_DumpFree(ClayDump dump);

#endif
