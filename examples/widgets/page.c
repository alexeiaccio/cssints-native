// The Widgets page on the desktop host: the generated C at one state (examples/widgets/page_generated*.c,
// generator/page-to-c.ts) as desktop/host.c's page, so its frame can be drawn by the same ThorVG raster the Solid page
// draws through and compared with the page's own stored frame (solid/frames/widgets-*.png).
//
// The page's size is its own (solid/app/Widgets.tsx's `size`: 360x760), and the host's width and height are compile-time
// (`desktop/host.c`'s APP_W/APP_H, which desktop/build.sh fixes at 360x360), so test.sh compiles this with
// -DAPP_W=360 -DAPP_H=760. The state is compile-time too: WIDGETS_FRAME names the frame function of the one generated
// file the build links (each file prints the page's styles as literals, so one is linked a time), and test.sh compiles
// it three times.
#include <stdbool.h>

void app_frame_rest(void);
void app_frame_switch(void);
void app_frame_disclosure(void);

#ifndef WIDGETS_FRAME
#define WIDGETS_FRAME app_frame_rest // the page at rest: `main.ts widgets --warm 30`
#endif

void app_frame(bool down)
{
    (void)down;
    WIDGETS_FRAME();
}

// the window's keys: this page is one static frame, so a key does nothing (host.c's non-PAGE_STATES branch calls it)
void app_key(int key) { (void)key; }
