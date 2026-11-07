#!/bin/sh
# The terminal target: the Sensors styles.ts -> styles.h and csssky-tui's styles.ts -> sky_styles.h, then the
# window-less host with the Sensors page and the sky screens (terminal/sky.c, thread.c, profile.c, notify.c) and the focus
# layer, on termbox2 (vendor/termbox2.h).
#   sh terminal/build.sh   -> terminal/demo
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/terminal/build"
mkdir -p "$OUT"
node --conditions=development "$ROOT/generator/clay-header.ts" "$ROOT/examples/sensors/styles.ts" "$OUT/styles.h"
node --conditions=development "$ROOT/generator/clay-header.ts" "$ROOT/terminal/sky_styles.ts" "$OUT/sky_styles.h"
cc -std=c99 -O2 -Wall -Wno-unused-parameter -Wno-unused-variable -Wno-missing-field-initializers \
  -I "$OUT" -I "$ROOT/vendor/clay" -I "$ROOT/terminal" -I "$ROOT/terminal/vendor" \
  "$ROOT/terminal/main.c" "$ROOT/terminal/page.c" "$ROOT/terminal/sky.c" "$ROOT/terminal/thread.c" \
  "$ROOT/terminal/profile.c" "$ROOT/terminal/notify.c" "$ROOT/terminal/focus.c" "$ROOT/terminal/shell.c" "$ROOT/terminal/scroll.c" \
  "$ROOT/terminal/format.c" "$ROOT/terminal/cells.c" "$ROOT/terminal/render.c" "$ROOT/terminal/measure.c" \
  "$ROOT/terminal/tb2.c" -lm -o "$ROOT/terminal/demo"
echo "$ROOT/terminal/demo"
