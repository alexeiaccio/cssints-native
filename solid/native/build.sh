#!/bin/sh
# Builds build/solid/libui.dylib: Clay, ThorVG's software raster and SDL3 behind the flat functions of ui.c.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/build/solid"
BREW="$(brew --prefix)"
mkdir -p "$OUT"
cc -std=c11 -O2 -Wall -Wno-unused-function -Wno-unused-variable -Wno-missing-field-initializers -dynamiclib \
  -I "$ROOT/vendor/clay" -I "$BREW/include" -I "$BREW/include/thorvg-1" \
  "$ROOT/solid/native/ui.c" -L "$BREW/lib" -lSDL3 -lSDL3_image -lthorvg-1 -lm -o "$OUT/libui.dylib"
echo "$OUT/libui.dylib"
