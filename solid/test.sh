#!/bin/sh
# Solid 2 on the desktop (step 4), from the repo root: the Solid Sensors page, its Clay tree built each frame through
# bun:ffi, against the C page's ThorVG frames, pixel for pixel. Needs bun and brew sdl3 sdl3_image thorvg.
set -e
sh solid/native/build.sh >/dev/null
bun solid/main.ts --expect examples/sensors/expected-thorvg.png
bun solid/main.ts --click 180 250 --expect examples/sensors/expected-thorvg-g.png
THEME=light bun solid/main.ts --expect examples/sensors/expected-thorvg-light.png
bun solid/test.ts
bun solid/main.ts --png "${TMPDIR:-/tmp}/cssints-native-solid.png" --bench 1000
