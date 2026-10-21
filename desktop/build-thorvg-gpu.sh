#!/bin/sh
# Builds an example against a ThorVG with the WebGPU engine, for `--raster thorvg-gpu`: brew's thorvg is CPU only
# (-Dengines=cpu), so this ThorVG is built from source in $TMPDIR, with wgpu-native (Metal on a Mac) as its WebGPU.
# Everything it downloads or compiles stays in $TMPDIR; the tree keeps only this script.
#
# Needs brew meson ninja pkgconf wgpu-native. The first run compiles ThorVG (~1 min); later runs reuse it.
#   desktop/build-thorvg-gpu.sh examples/sensors   -> build/sensors/app-gpu
#   desktop/build-thorvg-gpu.sh solid              -> build/solid/libui.dylib (the Solid host's, with ui_init_gpu)
set -e
EX="${1:?usage: desktop/build-thorvg-gpu.sh examples/<name>|solid}"
NAME="$(basename "$EX")"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build/$NAME"
BREW="$(brew --prefix)"
VER=1.1.3
WGPU="$BREW/opt/wgpu-native"
SRC="${TMPDIR:-/tmp}/thorvg-$VER"
BUILD="${TMPDIR:-/tmp}/thorvg-build-$VER"
PREFIX="${TMPDIR:-/tmp}/thorvg-prefix-$VER"
DEPS="${TMPDIR:-/tmp}/thorvg-deps"

for tool in meson ninja pkg-config; do
  command -v "$tool" >/dev/null || { echo "$tool is missing: brew install meson ninja pkgconf"; exit 1; }
done
[ -d "$WGPU" ] || { echo "wgpu-native is missing: brew install wgpu-native"; exit 1; }

# wgpu-native has no .pc of its own and ThorVG includes <webgpu/webgpu.h>: a small prefix in $TMPDIR provides both
[ -f "$WGPU/include/webgpu.h" ] || { echo "no $WGPU/include/webgpu.h"; exit 1; }
mkdir -p "$DEPS/include/webgpu" "$DEPS/lib/config"
ln -sf "$WGPU/include/webgpu.h" "$DEPS/include/webgpu/webgpu.h"
ln -sf "$WGPU/include/wgpu.h" "$DEPS/include/webgpu/wgpu.h"
ln -sf "$WGPU/lib/libwgpu_native.dylib" "$DEPS/lib/libwgpu_native.dylib"
cat > "$DEPS/lib/config/wgpu_native.pc" <<EOF
prefix=$DEPS
Name: wgpu_native
Description: wgpu-native, a native WebGPU implementation
Version: 29.0.1.1
Libs: -L\${prefix}/lib -lwgpu_native
Cflags: -I\${prefix}/include
EOF

if [ ! -f "$PREFIX/lib/libthorvg-1.dylib" ]; then
  [ -d "$SRC" ] || {
    curl -fsSL "https://github.com/thorvg/thorvg/archive/refs/tags/v$VER.tar.gz" -o "$SRC.tar.gz"
    tar xzf "$SRC.tar.gz" -C "${TMPDIR:-/tmp}" && mv "${TMPDIR:-/tmp}/thorvg-$VER" "$SRC" 2>/dev/null || true
  }
  PKG_CONFIG_PATH="$DEPS/lib/config" meson setup "$BUILD" "$SRC" \
    -Dengines=cpu,wg -Dloaders=all -Dsavers=all -Dbindings=capi -Dthreads=true -Dlog=false -Dtests=false \
    --buildtype=release --prefix="$PREFIX" >/dev/null
  ninja -C "$BUILD" >/dev/null
  ninja -C "$BUILD" install >/dev/null
fi

mkdir -p "$OUT"
if [ "$EX" = solid ]; then
  cc -std=c11 -O2 -Wall -Wno-unused-function -Wno-unused-variable -Wno-missing-field-initializers -dynamiclib \
    -DCLAY_THORVG_WG \
    -I "$ROOT/vendor/clay" -I "$BREW/include" -I "$PREFIX/include/thorvg-1" -I "$DEPS/include" \
    "$ROOT/solid/native/ui.c" \
    -L "$PREFIX/lib" -L "$DEPS/lib" -L "$BREW/lib" -lthorvg-1 -lwgpu_native -lSDL3 -lSDL3_image -lm \
    -Wl,-rpath,"$PREFIX/lib" -Wl,-rpath,"$DEPS/lib" -o "$OUT/libui.dylib"
  echo "$OUT/libui.dylib"
  exit 0
fi
node --conditions=development "$ROOT/generator/clay-header.ts" "$EX/styles.ts" "$OUT/styles.h"
cc -std=c11 -O2 -Wall -Wno-unused-function -Wno-missing-field-initializers -Wno-unused-variable \
  -DCLAY_THORVG_WG \
  -I "$OUT" -I "$ROOT/vendor/clay" -I "$BREW/include" -I "$PREFIX/include/thorvg-1" -I "$DEPS/include" \
  -DFONT_PATH="\"$ROOT/vendor/fonts/Roboto-Regular.ttf\"" \
  "$ROOT/desktop/host.c" "$EX/page.c" \
  -L "$PREFIX/lib" -L "$DEPS/lib" -L "$BREW/lib" -lthorvg-1 -lwgpu_native -lSDL3 -lSDL3_ttf -lSDL3_image -lm \
  -Wl,-rpath,"$PREFIX/lib" -Wl,-rpath,"$DEPS/lib" -o "$OUT/app-gpu"
echo "$OUT/app-gpu"
