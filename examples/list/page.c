// The List page on the desktop host: the generated C at rest (page_generated.c, generator/page-to-c.ts) as
// desktop/host.c's page, so its frame can be drawn by the same ThorVG raster the Solid page draws through and compared
// with the page's own stored frame (solid/frames/list-top.png).
//
// The page's size is its own (solid/app/List.tsx's `size`: 360x400), and the host's width and height are compile-time
// (`desktop/host.c`'s APP_W/APP_H, which desktop/build.sh fixes at 360x360 for the Sensors page), so test.sh compiles
// this with -DAPP_W=360 -DAPP_H=400 rather than adding a size flag to the host for one example.
#include "page_generated.c"

void app_frame(bool down)
{
    (void)down;
    app_frame_list();
}

// the window's keys: this page is one static frame, so a key does nothing (host.c's non-PAGE_STATES branch calls it)
void app_key(int key) { (void)key; }
