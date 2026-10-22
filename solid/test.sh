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
# the groups: Tab to each (6 stops before the radio, then the tab, its panel, the slider, the toolbar, the tree), then its keys
$W --keys Tab,Tab,Tab,Tab,Tab,Tab,Tab,ArrowRight --expect solid/frames/widgets-radio.png
$W --keys Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,ArrowRight --expect solid/frames/widgets-tabs.png
$W --keys Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,ArrowRight --expect solid/frames/widgets-slider.png
# a drag: press the slider's rail at a quarter, hold, move to three quarters (the knob follows, 80% at this step)
$W --drag 0.25 0.75 --expect solid/frames/widgets-slider-drag.png
# the toolbar: Bold on, to Italic, Tab away to the slider and back: Italic has the ring again (memory)
$W --keys Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Enter,ArrowRight,Shift+Tab,Tab --expect solid/frames/widgets-toolbar.png
# the toolbar's menu button: to Size, Down opens the menu under the item (the checked Medium has the dot and the focus ring)
$W --keys Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,ArrowRight,ArrowRight,ArrowDown --expect solid/frames/widgets-toolbar-menu.png
THEME=light $W --keys Tab,Tab,Space,Tab,Tab,Space,Tab,Tab,Enter,Tab,ArrowRight,Tab,ArrowRight,Tab,Tab,ArrowRight,ArrowRight,Tab,Enter --expect solid/frames/widgets-light.png
# the settings tree, 12 Tabs in: the ring on Network, the first visible row; Down moves it without selecting;
# Right on the closed Display opens it; Space selects the roving node
TREE="Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab"
$W --keys $TREE --expect solid/frames/widgets-tree-focus.png
$W --keys $TREE,ArrowDown --expect solid/frames/widgets-tree-down.png
$W --keys $TREE,ArrowDown,ArrowDown,ArrowDown,ArrowRight --expect solid/frames/widgets-tree-expanded.png
$W --keys $TREE,ArrowDown,ArrowDown,ArrowDown,ArrowRight,Space --expect solid/frames/widgets-tree-select.png
THEME=light $W --keys $TREE,ArrowDown,Space --expect solid/frames/widgets-tree-light.png
bun solid/widgets.test.ts
# the Dialog page (a modal dialog on a root-float backdrop and a menu floated off its trigger): its frames and asserts
D="bun solid/main.ts dialog"
$D --expect solid/frames/dialog-closed.png
$D --keys Tab,Enter --expect solid/frames/dialog-open.png
THEME=light $D --keys Tab,Enter --expect solid/frames/dialog-light.png
$D --keys Tab,Tab,Enter --expect solid/frames/dialog-menu.png
bun solid/dialog.test.ts
# the Text field page (the neutral createTextField on SDL's text input): an empty field with the caret, "Ada",
# a selection with Shift+ArrowLeft twice, a submit, and the light theme; then the caret and selection pixels and the keys
F="bun solid/main.ts form"
$F --keys Tab,Tab --expect solid/frames/field-empty.png
$F --keys Tab,Tab,text:Ada --expect solid/frames/field-typed.png
$F --keys Tab,Tab,text:Ada,Shift+ArrowLeft,Shift+ArrowLeft --expect solid/frames/field-selection.png
$F --keys Tab,Tab,text:Ada,Enter --expect solid/frames/field-submit.png
THEME=light $F --keys Tab,Tab,text:Ada --expect solid/frames/field-light.png
bun solid/field.test.ts
# the List page (Clay's own scroll container: the wheel moves its offset, the keys move the selection and scroll it into
# view): the top, scrolled by the wheel (both edges cut), the selection moved past the viewport, the light theme
L="bun solid/main.ts list"
DOWN12="Tab,ArrowDown,ArrowDown,ArrowDown,ArrowDown,ArrowDown,ArrowDown,ArrowDown,ArrowDown,ArrowDown,ArrowDown,ArrowDown,ArrowDown"
$L --expect solid/frames/list-top.png
$L --wheel 32 --expect solid/frames/list-wheel.png
$L --keys $DOWN12 --expect solid/frames/list-select.png
THEME=light $L --keys $DOWN12 --expect solid/frames/list-light.png
bun solid/list.test.ts
# the Sky page (csssky's feed: the tablist, the cards with drawn avatars, the wrapped bodies, Clay's scroll container):
# Discover, the Science tab, the light theme, and the Science feed 8 notches down (Discover's three posts fit the viewport)
S="bun solid/main.ts sky"
$S --expect solid/frames/sky.png
$S --click 180 32 --expect solid/frames/sky-science.png
THEME=light $S --expect solid/frames/sky-light.png
$S --click 180 32 --wheel 8 --wheel-over sky-feed --expect solid/frames/sky-scrolled.png
bun solid/sky.test.ts
# the inline-styles page (styles in the .tsx) against the same page with a .styles.ts: identical pixel for pixel, and its frame
bun solid/inline.test.ts
bun solid/main.ts --png "${TMPDIR:-/tmp}/cssints-native-solid.png" --bench 1000
bun solid/a11y.test.ts
