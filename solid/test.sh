#!/bin/sh
# Solid 2 on the desktop (step 4), from the repo root: the Solid Sensors page, its Clay tree built each frame through
# bun:ffi, against the C page's ThorVG frames, pixel for pixel. Needs bun and brew sdl3 sdl3_image thorvg.
set -e
sh solid/native/build.sh >/dev/null
bun solid/main.ts --expect examples/sensors/expected-thorvg.png
bun solid/main.ts --click 180 250 --expect examples/sensors/expected-thorvg-g.png
THEME=light bun solid/main.ts --expect examples/sensors/expected-thorvg-light.png
bun solid/test.ts
# the Widgets page (headless button, switch, checkbox, disclosure; the focus manager): scripted keys, then the frame
W="bun solid/main.ts widgets"
$W --expect solid/frames/widgets-initial.png
$W --keys Tab,Tab --expect solid/frames/widgets-tab2.png
$W --keys Tab,Tab,Space --expect solid/frames/widgets-switch-on.png
$W --keys Tab,Tab,Tab,Tab,Space --expect solid/frames/widgets-mixed.png
$W --keys Tab,Tab,Space,Tab,Tab,Tab,Tab,Enter --expect solid/frames/widgets-disclosure.png
THEME=light $W --keys Tab,Tab,Space,Tab,Tab,Space,Tab,Tab,Enter --expect solid/frames/widgets-light.png
bun solid/widgets.test.ts
bun solid/main.ts --png "${TMPDIR:-/tmp}/cssints-native-solid.png" --bench 1000
