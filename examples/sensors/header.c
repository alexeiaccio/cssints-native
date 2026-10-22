// styles.h of the Sensors page against the firmware's clay.h (C99): the state and the theme declarations exist and hold
// the colours of styles.ts, the rest of a state is the base's.
#include <assert.h>
#include <stdio.h>
#include <string.h>

#define CLAY_IMPLEMENTATION
#include "styles.h"

int main(void)
{
    assert(units_active.backgroundColor.r == 64 && units_active.backgroundColor.g == 70);
    assert(units_hover.backgroundColor.r == 48 && units_hover.backgroundColor.g == 53);
    assert(units_active.layout.sizing.width.size.minMax.min == 200 && units_active.cornerRadius.topLeft == 19);
    assert(units_active_light.backgroundColor.g == 221 && units_light.backgroundColor.r == 255);
    assert(units_hover_light.backgroundColor.g == 235);
    assert(root_light.backgroundColor.r == 244 && root.backgroundColor.r == 16);
    assert(title_text_light.textColor.r == 200 && title_text.fontId == font_Roboto);
    // the image: Clay 1.0's config is the pointer to the path, and the box is the picture's own 32x32
    assert(!strcmp((const char *)glyph.image.imageData, "examples/sensors/glyph.png"));
    assert(glyph.layout.sizing.width.size.minMax.min == 32 && glyph.layout.sizing.height.size.minMax.max == 32);
    assert(glyph.aspectRatio.aspectRatio == 1 && glyph_light.image.imageData != NULL);
    puts("sensors header: ok");
    return 0;
}
