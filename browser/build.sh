#!/bin/sh
# The browser target's wasm, two modules:
#   page.wasm  Clay + the generated Sensors page (browser/page.c): the no-JS path, a static frame and its use_g one
#   ui.wasm    the same flat ui_* surface solid/native/ui.c gives the desktop, over Clay only (browser/ui.c): what the
#              Solid page (browser/solid/) calls through browser/solid/ffi-browser.ts
# Output goes outside the repo; nothing here is committed except this script, because the wasms are build products.
#   sh browser/build.sh [out.directory]      -> <out>/page.wasm and <out>/ui.wasm (default ${TMPDIR:-/tmp}/cssints-native-web)
# Needs zig (wasm32-wasi libc, no emscripten) and node --conditions=development for the cssints plugin.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-${TMPDIR:-/tmp}/cssints-native-web}"
mkdir -p "$OUT"

# styles.h is the same header generator/clay-header.ts gives the C page on every target
node --conditions=development "$ROOT/generator/clay-header.ts" "$ROOT/examples/sensors/styles.ts" "$OUT/styles.h"

# A reactor (not a command) module: _initialize runs libc's constructors, and the exports are init/frame/cmds. No
# imports at all, so the page needs no WASI shim; measure is the only one (env.measure, from draw.js). The page is the
# generated state machine (--events): the wasm keeps the state and a press/release asks its table.
zig cc -target wasm32-wasi -mexec-model=reactor -Oz -Wall -Wno-unused-function -Wno-missing-field-initializers \
  -Wno-unused-variable -I "$OUT" -I "$ROOT/vendor/clay" -I "$ROOT/generator" \
  "$ROOT/browser/page.c" "$ROOT/examples/sensors/page_generated_events.c" \
  -Wl,--strip-all -o "$OUT/page.wasm"

# The Solid page's half of the same ABI. malloc and free are exported for the binding: a string, an id or a style's
# float array is written into the linear memory at an address it got from malloc (a libc allocation is not exported by
# a reactor unless it is asked for).
zig cc -target wasm32-wasi -mexec-model=reactor -Oz -Wall -Wno-unused-function -Wno-missing-field-initializers \
  -Wno-unused-variable -I "$ROOT/vendor/clay" -I "$ROOT/terminal" \
  "$ROOT/browser/ui.c" "$ROOT/terminal/cells.c" "$ROOT/terminal/render.c" \
  -Wl,--strip-all -Wl,--export=malloc -Wl,--export=free -o "$OUT/ui.wasm"

echo "$OUT/page.wasm ($(wc -c < "$OUT/page.wasm" | tr -d ' ') bytes)"
echo "$OUT/ui.wasm ($(wc -c < "$OUT/ui.wasm" | tr -d ' ') bytes)"
