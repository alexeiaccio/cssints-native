#!/bin/sh
# Builds build/solid/libui.dylib: Clay, ThorVG's software raster and SDL3 behind the flat functions of ui.c.
# ... and build/solid/libterm.dylib: the same declaration surface (a packed style, a text, the value channel) over the
# terminal's cell grid instead: Clay + terminal/cells.c, render.c, measure.c and termbox2 (solid/native/term.c).
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-$ROOT/build/solid}"
BREW="$(brew --prefix)"
mkdir -p "$OUT"
cc -std=c11 -O2 -Wall -Wno-unused-function -Wno-unused-variable -Wno-missing-field-initializers -dynamiclib \
  -I "$ROOT/vendor/clay" -I "$BREW/include" -I "$BREW/include/thorvg-1" \
  "$ROOT/solid/native/ui.c" -L "$BREW/lib" -lSDL3 -lSDL3_image -lthorvg-1 -lm -o "$OUT/libui.dylib"
echo "$OUT/libui.dylib"
cc -std=c11 -O2 -Wall -Wno-unused-function -Wno-unused-variable -Wno-missing-field-initializers -dynamiclib \
  -I "$ROOT/vendor/clay" -I "$ROOT/terminal" -I "$ROOT/terminal/vendor" \
  "$ROOT/solid/native/term.c" "$ROOT/terminal/cells.c" "$ROOT/terminal/render.c" \
  "$ROOT/terminal/measure.c" "$ROOT/terminal/tb2.c" -lm -o "$OUT/libterm.dylib"
echo "$OUT/libterm.dylib"
