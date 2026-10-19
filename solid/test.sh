#!/bin/sh
# Solid 2 on the desktop (step 4), from the repo root: the Solid Sensors page, its Clay tree built each frame through
# bun:ffi, against the C page's ThorVG frames, pixel for pixel. Needs bun and brew sdl3 sdl3_image thorvg.
set -e
sh solid/native/build.sh >/dev/null
bun solid/main.ts --expect examples/sensors/expected-thorvg.png
bun solid/main.ts --click 180 250 --expect examples/sensors/expected-thorvg-g.png
THEME=light bun solid/main.ts --expect examples/sensors/expected-thorvg-light.png
bun solid/test.ts
# the Widgets page (headless button, switch, checkbox, disclosure, radio, tabs, slider, toolbar; the focus manager): scripted keys, then the frame
W="bun solid/main.ts widgets"
$W --expect solid/frames/widgets-initial.png
$W --keys Tab,Tab --expect solid/frames/widgets-tab2.png
$W --keys Tab,Tab,Space --expect solid/frames/widgets-switch-on.png
$W --keys Tab,Tab,Tab,Tab,Space --expect solid/frames/widgets-mixed.png
$W --keys Tab,Tab,Space,Tab,Tab,Tab,Tab,Enter --expect solid/frames/widgets-disclosure.png
# the groups: Tab to each (6 stops before the radio, then the tab, its panel, the slider, the toolbar), then its keys
$W --keys Tab,Tab,Tab,Tab,Tab,Tab,Tab,ArrowRight --expect solid/frames/widgets-radio.png
$W --keys Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,ArrowRight --expect solid/frames/widgets-tabs.png
$W --keys Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,ArrowRight --expect solid/frames/widgets-slider.png
# the toolbar: Bold on, to Italic, Tab away to the slider and back: Italic has the ring again (memory)
$W --keys Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Enter,ArrowRight,Shift+Tab,Tab --expect solid/frames/widgets-toolbar.png
THEME=light $W --keys Tab,Tab,Space,Tab,Tab,Space,Tab,Tab,Enter,Tab,ArrowRight,Tab,ArrowRight,Tab,Tab,ArrowRight,ArrowRight,Tab,Enter --expect solid/frames/widgets-light.png
bun solid/widgets.test.ts
bun solid/main.ts --png "${TMPDIR:-/tmp}/cssints-native-solid.png" --bench 1000
