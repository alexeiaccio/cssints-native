#!/bin/sh
# Builds an example for the desktop: styles.ts -> styles.h, then the host with the example's page.c.
#   desktop/build.sh examples/sensors                     -> build/sensors/app
#   desktop/build.sh examples/sensors --generated         -> build/sensors/app-generated
# The second links the page as the generated state machine (examples/sensors/page_generated_events.c, from
# generator/page-to-c.ts --events) instead of the hand-written page.c: the host keeps the state and dispatches a click
# through the table (desktop/host.c's PAGE_STATES).
set -e
EX="${1:?usage: desktop/build.sh examples/<name> [--generated]}"
NAME="$(basename "$EX")"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$ROOT/build/$NAME}"
BREW="$(brew --prefix)"
GENERATED=0
for arg in "$@"; do [ "$arg" = "--generated" ] && GENERATED=1; done
PAGE="$EX/page.c"
BIN="$OUT/app"
FLAGS=""
if [ "$GENERATED" = 1 ]; then
  PAGE="$EX/page_generated_events.c"
  BIN="$OUT/app-generated"
  FLAGS="-DPAGE_STATES -DPAGE_STATE_PREFIX=$NAME"
fi
mkdir -p "$OUT"
node --conditions=development "$ROOT/generator/clay-header.ts" "$EX/styles.ts" "$OUT/styles.h"
cc -std=c11 -O2 -Wall -Wno-unused-function -Wno-missing-field-initializers -Wno-unused-variable \
  -I "$OUT" -I "$ROOT/vendor/clay" -I "$ROOT/generator" -I "$BREW/include" -I "$BREW/include/thorvg-1" \
  -DFONT_PATH="\"$ROOT/vendor/fonts/Roboto-Regular.ttf\"" $FLAGS \
  "$ROOT/desktop/host.c" "$PAGE" \
  -L "$BREW/lib" -lSDL3 -lSDL3_ttf -lSDL3_image -lthorvg-1 -lm -o "$BIN"
echo "$BIN"
