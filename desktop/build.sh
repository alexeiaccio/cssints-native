#!/bin/sh
# Builds an example for the desktop: styles.ts -> styles.h, then the host with the example's page.c.
#   desktop/build.sh examples/sensors        -> build/sensors
set -e
EX="${1:?usage: desktop/build.sh examples/<name>}"
NAME="$(basename "$EX")"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build/$NAME"
BREW="$(brew --prefix)"
mkdir -p "$OUT"
node --conditions=development "$ROOT/generator/clay-header.ts" "$EX/styles.ts" "$OUT/styles.h"
cc -std=c11 -O2 -Wall -Wno-unused-function -Wno-missing-field-initializers -Wno-unused-variable \
  -I "$OUT" -I "$ROOT/vendor/clay" -I "$BREW/include" -I "$BREW/include/thorvg-1" \
  -DFONT_PATH="\"$ROOT/vendor/fonts/Roboto-Regular.ttf\"" \
  "$ROOT/desktop/host.c" "$EX/page.c" \
  -L "$BREW/lib" -lSDL3 -lSDL3_ttf -lSDL3_image -lthorvg-1 -lm -o "$OUT/app"
echo "$OUT/app"
