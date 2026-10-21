#!/bin/sh
# Builds the swapchain experiment: desktop/wg_window.c, ThorVG drawing into the window's own WebGPU surface and
# presenting it, no frame back on the CPU. Opt-in, and separate from the defaults: `sh desktop/build.sh` and the
# `--raster thorvg-gpu` build are untouched by it.
#
# It needs the same ThorVG: -Dengines=wg against wgpu-native in $TMPDIR, which desktop/build-thorvg-gpu.sh sets up. The
# first run of either compiles ThorVG (~1 min), later ones reuse it.
#   sh desktop/build-wg-window.sh            -> build/sensors/wg-window
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build/sensors"
BREW="$(brew --prefix)"
VER=1.1.3
PREFIX="${TMPDIR:-/tmp}/thorvg-prefix-$VER"
DEPS="${TMPDIR:-/tmp}/thorvg-deps"

[ -f "$PREFIX/lib/libthorvg-1.dylib" ] && [ -d "$DEPS/include/webgpu" ] ||
  sh "$ROOT/desktop/build-thorvg-gpu.sh" examples/sensors >/dev/null

mkdir -p "$OUT"
node --conditions=development "$ROOT/generator/clay-header.ts" "$ROOT/examples/sensors/styles.ts" "$OUT/styles.h"
cc -std=c11 -O2 -Wall -Wno-unused-function -Wno-unused-variable -Wno-missing-field-initializers \
  -I "$OUT" -I "$ROOT/vendor/clay" -I "$BREW/include" -I "$PREFIX/include/thorvg-1" -I "$DEPS/include" \
  -DFONT_PATH="\"$ROOT/vendor/fonts/Roboto-Regular.ttf\"" \
  "$ROOT/desktop/wg_window.c" "$ROOT/examples/sensors/page.c" \
  -L "$PREFIX/lib" -L "$DEPS/lib" -L "$BREW/lib" -lthorvg-1 -lwgpu_native -lSDL3 -lSDL3_image -lm \
  -Wl,-rpath,"$PREFIX/lib" -Wl,-rpath,"$DEPS/lib" -o "$OUT/wg-window"
echo "$OUT/wg-window"
