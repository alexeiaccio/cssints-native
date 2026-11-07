#!/bin/sh
# Solid 2 on the desktop (step 4), from the repo root: the Solid Sensors page, its Clay tree built each frame through
# bun:ffi, against the C page's ThorVG frames, pixel for pixel. Needs bun and brew sdl3 sdl3_image thorvg.
set -e
cd "$(dirname "$0")/.."
sh solid/native/build.sh >/dev/null
# every page now has a first-mount entry (src/entry.ts: the root's subtree rises 8px and fades in over 0.25s, ~21 frames
# to its settle): a stored frame of a page at rest is taken after `--warm 30`, which is the settled frame the frames below
# have always been. The Sensors page gets it too.
S0="bun solid/main.ts --warm 30"
$S0 --expect examples/sensors/expected-thorvg.png
$S0 --click 180 250 --expect examples/sensors/expected-thorvg-g.png
THEME=light $S0 --expect examples/sensors/expected-thorvg-light.png
# a scene from the shared format (examples/sensors/scenes/sensors-click.json): a click on the pill at its coordinates,
# 30 frames of settle, the last frame the same one the C host replays from the same file
bun solid/main.ts --scene examples/sensors/scenes/sensors-click.json --expect examples/sensors/expected-thorvg-g.png
bun solid/test.ts
# the Widgets page (headless button, switch, checkbox, disclosure, radio, tabs, slider, toolbar; the focus manager): scripted keys, then the frame
# the page's entry is over by the first key: every frame below is at rest (`--warm 30`)
W() { bun solid/main.ts widgets --warm 30 "$@"; }
W --expect solid/frames/widgets-initial.png
W --keys Tab,Tab --expect solid/frames/widgets-tab2.png
W --keys Tab,Tab,Space --expect solid/frames/widgets-switch-on.png
W --keys Tab,Tab,Tab,Tab,Space --expect solid/frames/widgets-mixed.png
W --keys Tab,Tab,Space,Tab,Tab,Tab,Tab,Enter --expect solid/frames/widgets-disclosure.png
# the groups: Tab to each (6 stops before the radio, then the tab, its panel, the slider, the toolbar, the tree), then its keys
W --keys Tab,Tab,Tab,Tab,Tab,Tab,Tab,ArrowRight --expect solid/frames/widgets-radio.png
W --keys Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,ArrowRight --expect solid/frames/widgets-tabs.png
W --keys Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,ArrowRight --expect solid/frames/widgets-slider.png
# a drag: press the slider's rail at a quarter, hold, move to three quarters (the knob follows, 80% at this step)
W --drag 0.25 0.75 --expect solid/frames/widgets-slider-drag.png
# the toolbar: Bold on, to Italic, Tab away to the slider and back: Italic has the ring again (memory)
W --keys Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Enter,ArrowRight,Shift+Tab,Tab --expect solid/frames/widgets-toolbar.png
# the toolbar's menu button: to Size, Down opens the menu under the item (the checked Medium has the dot and the focus ring)
W --keys Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,ArrowRight,ArrowRight,ArrowDown --expect solid/frames/widgets-toolbar-menu.png
THEME=light bun solid/main.ts widgets --warm 30 --keys Tab,Tab,Space,Tab,Tab,Space,Tab,Tab,Enter,Tab,ArrowRight,Tab,ArrowRight,Tab,Tab,ArrowRight,ArrowRight,Tab,Enter --expect solid/frames/widgets-light.png
# the storybook page: the rail reads @cssints/stories over native story files and is one vertical tablist (the native
# headless tabs): Tab enters it on the picked story, Up and Down move the roving focus and pick the story the canvas draws
# (automatic activation), and the story's own controls are the Tab stops after it. Down picks the second story; Tab past
# the rail reaches the disclosure's trigger, which Space opens.
# Under the canvas is the story's controls panel: one row per arg the story declares (`argTypes`), each a native headless
# part — a `boolean` a switch, a `select` a vertical radio group, a `range`/`number` a slider, a `text` a text field — and
# a control writes the arg, which mounts the story again with it (the canvas is keyed on the story and its args). `--arg
# name=value` starts the opened story with an arg, typed by the control it declares: the switch's `on` and `label`, the
# tempo's `speed`, the volume's `volume`. The panel's rows are Tab stops after the story's own, so three Tabs from the
# rail reach the switch's `on` and Space flips it (`storybook-controls.png`: both switches on, the ring on the panel's).
SB() { bun solid/main.ts storybook --warm 30 "$@"; }
SB --expect solid/frames/storybook.png
SB --keys Tab,ArrowDown --expect solid/frames/storybook-keys.png
SB --keys Tab,Tab,Space --expect solid/frames/storybook-open.png
SB --story widgets--switch --arg on=true --expect solid/frames/storybook-arg-on.png
SB --story widgets--switch --arg label=Wi-Fi --expect solid/frames/storybook-arg-text.png
SB --story widgets--tempo --arg speed=16x --expect solid/frames/storybook-arg-select.png
SB --story widgets--volume --arg volume=70 --expect solid/frames/storybook-arg-range.png
SB --story widgets--switch --keys Tab,Tab,Tab,Space --expect solid/frames/storybook-controls.png
SB --keys Tab,ArrowDown,Tab,Space --expect solid/frames/storybook-rail-tab.png
# a story as a file: the scene names the page and the story, and its steps are the input — the native half of a link
bun solid/main.ts --scene solid/scenes/storybook-switch.json --expect solid/frames/storybook-scene.png
# the settings tree, 12 Tabs in: the ring on Network, the first visible row; Down moves it without selecting;
# Right on the closed Display opens it; Space selects the roving node
TREE="Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab"
W --keys $TREE --expect solid/frames/widgets-tree-focus.png
W --keys $TREE,ArrowDown --expect solid/frames/widgets-tree-down.png
W --keys $TREE,ArrowDown,ArrowDown,ArrowDown,ArrowRight --expect solid/frames/widgets-tree-expanded.png
W --keys $TREE,ArrowDown,ArrowDown,ArrowDown,ArrowRight,Space --expect solid/frames/widgets-tree-select.png
THEME=light bun solid/main.ts widgets --warm 30 --keys $TREE,ArrowDown,Space --expect solid/frames/widgets-tree-light.png
bun solid/widgets.test.ts
# the Dialog page (a modal dialog on a root-float backdrop and a menu floated off its trigger): its frames and asserts.
# The panel drops in (its float's offset y -14 -> 0, its shadow's blur 0 -> 32) and the menu slides out of its trigger
# (offset y -10 -> -20, blur 0 -> 14) through the value channel, so a stored frame is taken at rest (`--settle 30`) and
# the mid-slide one three frames after the key opens it (one for the key, two settles, dt = 1/60). The panel and the
# menu also arrive as one scene each (the group: alpha 88% -> 100% and scale 96% -> 100%, fields 46 and 47), and the
# menu leans out of a -2° tilt (`FIELDS.ROTATE`, field 55, about its box centre: a scene transform, so no box moves), so
# `dialog-entry-mid` is three frames in and `dialog-menu-mid` two.
# Closing runs the same tracks the other way (panel
# 0 -> 14, 32 -> 0, 225 -> 0 and 100% -> 96%; backdrop 140 -> 0; menu -20 -> -10, 14 -> 0, the tilt back to -2° and the
# same fade) while the
# node stays mounted (`presence`), so `dialog-exit-mid` is two frames into the exit and is the one stored frame whose
# pixels moved for the group (a settled frame writes alpha 255 and scale 1, which makes no scene at all); a
# `--reduced-motion` run lands on `dialog-open` in one frame (no entry, no exit: the flag is the platform's)
D="bun solid/main.ts dialog"
$D --expect solid/frames/dialog-closed.png
$D --keys Tab,Enter --settle 30 --expect solid/frames/dialog-open.png
$D --keys Tab,Enter --settle 3 --expect solid/frames/dialog-entry-mid.png
THEME=light $D --keys Tab,Enter --settle 30 --expect solid/frames/dialog-light.png
$D --keys Tab,Tab,Enter --settle 30 --expect solid/frames/dialog-menu.png
$D --keys Tab,Tab,Enter --settle 2 --expect solid/frames/dialog-menu-mid.png
$D --keys Tab,Enter,Escape --settle 2 --expect solid/frames/dialog-exit-mid.png
$D --reduced-motion --keys Tab,Enter --expect solid/frames/dialog-open.png
# the menu's glass (css.backdrop) over the light page: a translucent white, the blurred page showing through
THEME=light $D --keys Tab,Tab,Enter --settle 30 --expect solid/frames/dialog-menu-light.png
bun solid/dialog.test.ts
# the Text field page (the neutral createTextField on SDL's text input): an empty field with the caret, "Ada",
# a selection with Shift+ArrowLeft twice, a submit, and the light theme; then the caret and selection pixels and the keys
F() { bun solid/main.ts form --warm 30 "$@"; }
F --keys Tab,Tab --expect solid/frames/field-empty.png
F --keys Tab,Tab,text:Ada --expect solid/frames/field-typed.png
F --keys Tab,Tab,text:Ada,Shift+ArrowLeft,Shift+ArrowLeft --expect solid/frames/field-selection.png
F --keys Tab,Tab,text:Ada,Enter --expect solid/frames/field-submit.png
THEME=light bun solid/main.ts form --warm 30 --keys Tab,Tab,text:Ada --expect solid/frames/field-light.png
bun solid/field.test.ts
# the List page (its viewport on the page's own track: the wheel's 10px, the keyboard's reveal, the drag, the band): the
# top, scrolled 32 notches (a rest frame between them, so the run is the notches' own 320 and not a flick), the selection
# moved past the viewport and eased into view, the light theme
# (the settles after a scroll are 90 frames, not 60: the scrollbar holds 0.6s after the track stops and fades out in
# 0.15s, so a frame at rest — today's pixels, no thumb on it — is a little later than the offset's own settle)
L() { bun solid/main.ts list --warm 30 "$@"; }
# the entry's own frame: four frames in, the page a blend of its colour over the ground (main.ts --settle 3)
bun solid/main.ts list --settle 3 --expect solid/frames/list-entry.png
DOWN12="Tab,ArrowDown,ArrowDown,ArrowDown,ArrowDown,ArrowDown,ArrowDown,ArrowDown,ArrowDown,ArrowDown,ArrowDown,ArrowDown,ArrowDown"
L --expect solid/frames/list-top.png
L --wheel 32 --wheel-rest --settle 90 --expect solid/frames/list-wheel.png
# the wide layout: the same 240px viewport with 900px rows, 12 horizontal notches right (120px of the 620 the rows are
# wider than the viewport) a rest frame apart, so the run is the notches' own 120 and not a flick; the page's tree is the
# default one plus the wide cells and the horizontal bar, so list-top/list-wheel/list-select/list-light are untouched
L --wide --wheel-x 12 --wheel-rest --settle 90 --expect solid/frames/list-wide.png
L --keys $DOWN12 --settle 90 --expect solid/frames/list-select.png
THEME=light bun solid/main.ts list --warm 30 --keys $DOWN12 --settle 90 --expect solid/frames/list-light.png
bun solid/list.test.ts
# the motion model (a spring from duration and bounce, a track that retargets from the presented x and v, the exact
# settle, the effect class's clamp, the decay's projection): no page, no Clay
bun solid/motion.test.ts
# the Sky page (csssky's feed: the tablist, the cards with drawn avatars, the wrapped bodies, the feed's own motion track):
# Discover, the Science tab, the light theme, and the Science feed eight notches down, settled (the track flings to the end).
# The cards arrive on mount (12px low, at 0 opacity, each 50ms after the one above, 0.3s: the group's translate and alpha),
# a card's and a tab's hover is a 120ms fade and a tab's underline fades with it, so the resting frames are taken after
# `--settle` (the entry is over 0.4s from the mount) — every one of them is byte-identical to its old self, the entry and
# the hover are the frames that moved. `sky-entry` is ten frames in (the three cards at 2, 4 and 10px of their 12),
# `sky-hover` is the pointer on the second card three frames into its fade (no press: `--move`), and `sky-band` is
# Discover four notches past its end (its content is shorter than the viewport, so the first notch is already past it):
# the resistance's f(40) puts it 21.3px out, and the band has let go 80ms later. `sky-tab-mid` is a tab switch two
# frames in: the label's colour fading between the muted token and the accent (`FIELDS.TEXT_COLOR` on the text's id).
S="bun solid/main.ts sky"
$S --settle 40 --expect solid/frames/sky.png
$S --click 180 32 --settle 40 --expect solid/frames/sky-science.png
THEME=light $S --settle 40 --expect solid/frames/sky-light.png
$S --click 180 32 --wheel 8 --wheel-over sky-feed --settle 90 --expect solid/frames/sky-scrolled.png
$S --settle 9 --expect solid/frames/sky-entry.png
$S --settle 40 --move 180 300 3 --expect solid/frames/sky-hover.png
$S --warm 40 --wheel 4 --wheel-over sky-status --expect solid/frames/sky-band.png
# a tab switch two frames in (the tablist's first stop, then ArrowRight): the label's colour and the 2px underline both
# mid-fade, the new label between the muted token and the accent — the text's own four floats, not the tab's box's
$S --warm 40 --keys Tab,ArrowRight --settle 2 --expect solid/frames/sky-tab-mid.png
# the thread screen (the page's second screen): a click on the second card opens Titania's thread — the header with the
# Back control, the root card with the accent border, the replies indented 16px a depth, the tombstone and the
# "Show 1 more reply" row. The screen enters as one group (12px low, 0 opacity, 0.3s: the page's card entry), so the
# resting frame is 40 frames after the click and `sky-thread-mid` is two frames into the entry. `sky-thread-scrolled` is
# six notches down with a rest frame between them (the notches' own 60, not a flick) and its thumb faded out by the 90
# frames; `sky-thread-light` is the light theme. `sky-thread-more` is the deeper thread a "Show 1 more reply" row opens:
# that row is only in view at the thread's end, so it takes a second click there (`--click2`, a frame's press and release
# after the settle, then its own settle)
$S --warm 40 --click 180 380 --settle 40 --expect solid/frames/sky-thread.png
$S --warm 40 --click 180 380 --settle 2 --expect solid/frames/sky-thread-mid.png
$S --warm 40 --click 180 380 --wheel 6 --wheel-rest --settle 90 --expect solid/frames/sky-thread-scrolled.png
THEME=light $S --warm 40 --click 180 380 --settle 40 --expect solid/frames/sky-thread-light.png
$S --warm 40 --click 180 380 --wheel 20 --wheel-over sky-thread-view --settle 90 --click2 180 730 --settle2 40 --expect solid/frames/sky-thread-more.png
# a finger's tap is the mouse's click through the same mapping (ui_touch_map: SDL's normalised 0..1 of the window to the
# layout's pixels): a tap at the window's middle (0.5,0.5 -> 180,380) is the frame of a click at 180,380 (the second card
# selected). No touchscreen here: this is the mapping, and what a page does with the flag is sky.test.ts's (a finger's 2px
# drag is not a card click, the mouse's is).
$S --click 180 380 --png "${TMPDIR:-/tmp}/cssints-touch.png" >/dev/null
$S --touch 0.5 0.5 --expect "${TMPDIR:-/tmp}/cssints-touch.png"
bun solid/sky.test.ts
# ... and the thread screen's own test: the rows and their indents, its scroll and thumb, back's frame, the history, the
# entry and reduced motion, the a11y tree, the stored frame, and the mutations
bun solid/thread.test.ts
# ... and the page's wide form (app/Sky.tsx): at 720px the thread is a 360px column beside the feed — both panes declared,
# the feed's offset and its selected card untouched by the open, the thread's rows in the right column — and below it the
# root float over the feed, as every frame above has it
bun solid/sky-wide.test.ts
# the text sheet (the strings and the sizes the app draws) and its oracle: the frame, then the metric against the same
# lines drawn by CoreText — the ink weight and the shape of every line (solid/text.test.ts). The oracle is a stored PNG;
# re-draw it with `bun solid/text-oracle.ts --update` (needs swiftc, so only there)
X="bun solid/main.ts sheet"
$X --expect solid/frames/text-sheet.png
$X --density 2 --expect solid/frames/text-sheet-2x.png
bun solid/text.test.ts
# the window (src/virtual.ts) with more data than a screen: 1,000 fixed rows and 200 cards of mixed height — the declared
# subset (nine to eleven rows, at most ten cards), the spacers are the real content, the reveal outside the window, the
# fallback for a jumped-over card, and the declare cost of 1,000 rows against 30 (and 200 cards against 3)
bun solid/virtual.test.ts
# a gradient and a clip inside a *rotated* group (no page has one): the clip paint turns with its scene, the gradient with
# its shape, and the dither's mark is the rotated quad, so no page pixel around it is stippled (a hand-built tree, no page)
bun solid/rotated.test.ts
# idle frames: a page at rest declares and lays out every frame but draws and presents none (`--idle N` prints the draws
# it made), and a key is a discrete input that draws its own frame
$S --settle 60 --idle 60 | grep -q "draws 0 of 60"
$S --settle 60 --idle 60 --idle-keys 20 | grep -q "draws 3 of 60, 3 of them the keys"
bun solid/idle.test.ts
# the inline-styles page (styles in the .tsx) against the same page with a .styles.ts: identical pixel for pixel, and its frame
bun solid/inline.test.ts
bun solid/main.ts --png "${TMPDIR:-/tmp}/cssints-native-solid.png" --bench 1000
bun solid/a11y.test.ts
# metamorphic relations (Rune's research 14): a pass-through wrapper, a whole-pixel move, wrap monotonicity, and the same
# tree twice in one process — properties with no stored frame and no oracle
bun solid/metamorphic.test.ts
# the Sky thread's data is the AppView's now (the page's `load` prop; solid/app/Sky.tsx), and a stored frame never fetches:
# a --png/--expect run loads apps/csssky's recorded getPostThread answer (apps/csssky/test/fixtures/thread.json) through
# the page's own shaping of it, which is what the five thread frames above show (`--offline` says so for a run that writes
# no frame). The loader's other two states have frames of their own: `--pending` a promise that never settles (the
# muted "Loading the thread…" row) and `--fail` a loader that throws ("The thread could not be loaded" and its Retry).
# Nothing here makes a request; solid/thread.test.ts injects its own promises.
$S --offline --warm 40 --click 180 380 --settle 40 --expect solid/frames/sky-thread.png
$S --offline --warm 40 --click 180 380 --settle 40 --pending --expect solid/frames/sky-thread-loading.png
$S --offline --warm 40 --click 180 380 --settle 40 --fail --expect solid/frames/sky-thread-error.png
# the dev page (the map's item 7, first half): the Widgets page with a panel beside it — its a11y tree, the box under the
# pointer and the frame's four phases (solid/app/Dev.tsx, 660x760). The page on the left is the same component the
# `widgets` page runs, so the frames below show it unchanged. Its four stored frames are NOT compared: the panel prints
# the frame's milliseconds, and two runs of a page at rest differ by 13,661 pixels of the 501,600 (the digits, and the
# reflow they cause) — dev.test.ts is what holds the panel's content and checks the stored four are this page's. The runs
# below are the smoke test, and the stored frames are what `--png solid/frames/dev*.png` made.
DEV="bun solid/main.ts dev"
$DEV --warm 30 --png "${TMPDIR:-/tmp}/cssints-dev.png"
$DEV --warm 30 --move 180 134 3 --png "${TMPDIR:-/tmp}/cssints-dev-hover.png"
THEME=light $DEV --warm 30 --png "${TMPDIR:-/tmp}/cssints-dev-light.png"
$DEV --warm 30 --keys Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab,Tab --settle 2 --png "${TMPDIR:-/tmp}/cssints-dev-tree.png"
# the panel's three sections against the page's own tree: the 28 rows, the ring after Tab, the hovered box, the phases
# and the counters (and the four frames of the page)
bun solid/dev.test.ts
# a scene as a file (Rune's item 4, docs/map.md): one JSON of typed events with times drives the page's own frame loop,
# so a stored frame is compared against a *sequence* of input and not one state. The four scenes are the record of four
# stored frames, byte for byte; scene.test.ts replays them in-process (their steps, frames and ending state), mutates two
# of them to show the frames move (Space before Tab: 964 pixels; the List's settle dropped: 15,445), and pins the
# validation messages (an unknown kind, a step out of order, a missing size, a size that is not the page's)
for scene in widgets-switch-on list-select sky-scrolled dialog-menu; do
  bun solid/main.ts --scene "solid/scenes/$scene.json" --expect "solid/frames/$scene.png"
done
bun solid/scene.test.ts
# the command-stream goldens (Rune's item 5): five pages' last frames as JSON — every command field a draw reads, the
# renderer's tables beside the commands (a shadow, a backdrop, a gradient, a group, the text weight) and the a11y
# snapshot — against solid/goldens/. A pixel diff says 300 pixels moved; a miss here says which command and which field:
# `FAIL sensors: command 2 (text "accel m/s²") colour 150/155/170/255 -> 160/165/180/255`. The frames are the pages'
# stored ones (Sensors, Widgets, the List's top, the Sky's Discover settled) and the Dialog's menu two frames into its
# slide, the one frame that carries every table. Re-store a page after a deliberate change — read the diff first — with
# `bun solid/dump.ts <page> --update`; one page's JSON alone with `bun solid/dump.ts <page>` (stdout).
bun solid/dump.test.ts
# the profile screen (the page's third screen): a card's author — its name-and-handle row, the app's own `<a>` on the
# name (apps/csssky/src/post/Post.tsx) — opens apps/csssky's recorded profile (test/fixtures/profile-head.json and the
# three author feeds, read by solid/app/profile.ts; nothing fetches): the drawn 56px disc, the name, handle, bio and
# counts, the app's Posts/Replies/Media tabs as a headless tablist, and each tab's cards on the page's own scroll machine
# (a fresh one per tab, so a switch starts at the top). Back / Escape return to the feed it left, or to the thread a
# thread's card opened it from, untouched under it. The screen enters as one group (12px low, 0 opacity, 0.3s, the card
# entry's tracks), so `sky-profile-mid` is two frames into it; `sky-profile-media` is a second headless click on the Media
# tab after the settle (its ring and underline, and thirteen cards with their media lines).
$S --warm 40 --click 180 155 --settle 40 --expect solid/frames/sky-profile.png
$S --warm 40 --click 180 155 --settle 2 --expect solid/frames/sky-profile-mid.png
THEME=light $S --warm 40 --click 180 155 --settle 40 --expect solid/frames/sky-profile-light.png
$S --warm 40 --click 180 155 --settle 40 --click2 178 289 --settle2 40 --expect solid/frames/sky-profile-media.png
# ... and the screen's own test: the recording's head and tabs, the press, the tabs' lists, the list's scroll and thumb, a
# switch back to the top, back's byte-identical frame, a profile from a thread returning to it, the entry and reduced
# motion, the a11y tree, the stored frames, and the mutations
bun solid/profile.test.ts
# the Sky's settings screen (the page's third, app/Settings.tsx): the gear at the bar's right end opens it — three rows,
# each one a real control: the theme radio switches the page's palette (every style's variant is picked by the frame's
# theme, which the pick writes to the host, so the bar and the cards turn with the screen), the reduced-motion switch
# calls `setReducedMotion` (the flag every track reads), and the text size re-lays the feed's cards out (their height, the
# feed's content and its thumb). `sky-settings` is the screen at rest, `sky-settings-mid` the entry two frames in (12px
# low, 0 opacity, the page's card entry), `sky-settings-light` the light palette with Light picked (the theme group is one
# Tab from the back control, an arrow picks) and `sky-settings-large` the Large text (three Tabs to the size group)
SG="bun solid/main.ts sky"
$SG --warm 40 --click 324 32 --settle 40 --expect solid/frames/sky-settings.png
$SG --warm 40 --click 324 32 --settle 2 --expect solid/frames/sky-settings-mid.png
THEME=light $SG --warm 40 --click 324 32 --keys Tab,ArrowRight --settle 40 --expect solid/frames/sky-settings-light.png
$SG --warm 40 --click 324 32 --keys Tab,Tab,Tab,ArrowRight --settle 40 --expect solid/frames/sky-settings-large.png
bun solid/settings.test.ts
# the dev panel's live values (Rune's item 7, second half): the panel's fourth section writes a style's packed fields
# through the value channel (`ui.value`) while the page runs — the picked box's numbers, edited with the panel's own
# keys, with `r`/`Shift+R` dropping the override so the declare is the style's literal again. tune.test.ts holds it: the
# switch's 17 rows and their numbers, the panel's three Tab stops, a radius's corner pixel, a width's box and a11y
# bounds, a colour's fill, the clamps at 255 and 0, `r` and `Shift+R` byte for byte, the `*`, the row window, and the
# cost with five rows overridden (0.050 ms of declare and 0.033 of layout at rest, 0.048/0.038 with five: the noise).
bun solid/tune.test.ts
# the desktop's dev loop (solid/watch.ts): a style save restarts the page it keeps, a broken save prints the compiler's
# error and keeps the last good frame, a .c save rebuilds libui.dylib and a .tsx-only save builds nothing. On a temp copy
# of the repo (--root), so the check writes no file of this tree; needs the dylib build.sh just made and brew's SDL_image
bun solid/watch-check.mjs

# The same page in a browser, on these modules: the desktop's src/frame.ts and src/renderer.ts over Clay in wasm
# (browser/ui.c), the command array and the renderer's tables drawn by browser/draw.js, the pointer from the page's
# mouse. solid-check.mjs compares the Sensors page's base frame with goldens/sensors.json, a real click on the Units pill
# with the no-JS page's use_g frame, the raster with browser/expected.png; sky-check.mjs the Sky page's settled frame
# against the desktop's frames/sky.png (per box and per text line), its card's gradient, its avatars and the cards' entry
# (a group). Both print the bundle's and the wasm's size and the frame's ms. Skips (with a message) when zig, bun or
# Playwright's chromium is not installed.
# (browser/ui.c), the command array drawn by browser/draw.js, the pointer from the page's mouse. The check compares the
# base frame with goldens/sensors.json, a real click on the Units pill with the no-JS page's use_g frame, the raster
# with browser/expected.png, and prints the bundle's and the wasm's size and the frame's ms. Skips (with a message) when
# zig, bun or Playwright's chromium is not installed.
# The Widgets page (browser/solid/widgets.ts) is the second one, and the one with keys: the same shell, its own Input, the
# DOM's Tab/Shift+Tab/Space/Enter/arrows/Home/End named by browser/solid/keys.ts. The check drives them with Playwright's
# keyboard — Tab twice focuses the Wi-Fi switch (the a11y snapshot and the ring's pixel), Space checks it (the snapshot, the
# track's fill, a pixel), Tab to the settings tree and ArrowDown move the roving node — and compares the base frame with
# goldens/widgets.json (4px boxes) and the raster with browser/expected-widgets.png and solid/frames/widgets-initial.png.
# The Dialog page (browser/solid/dialog.ts) is the two root floats and the menu's glass: dialog-check.mjs holds the
# closed, open and mid-entry frames to solid/frames/dialog-*, the menu's mid-slide frame to solid/goldens/dialog.json
# (a shadow, a backdrop and a group in one frame), and the backdrop's blur as an A/B against `?glass=0`.
# ... and a finger: touch-check.mjs drives Chromium's own touch (CDP's Input.dispatchTouchEvent, the context's `hasTouch`)
# on the List and the Sky — the frame's `touch` flag, the List's 40px row drag and its thumb's 20px (74.83 of offset), the
# Sky's 120px drag into the rubber band and a throw resting where the decay projects, a tap that selects and opens, a 5px
# drag that does not — and the mouse's frames at rest (the other four checks).
if command -v zig >/dev/null 2>&1 && command -v bun >/dev/null 2>&1 &&
   node -e 'process.exit(require("node:fs").existsSync(require("playwright").chromium.executablePath()) ? 0 : 1)' 2>/dev/null; then
  sh browser/build.sh >/dev/null
  bun browser/solid/build.ts >/dev/null
  node browser/solid-check.mjs
  node browser/sky-check.mjs
  node browser/dialog-check.mjs
  node browser/input-check.mjs
  node browser/ime-check.mjs
  node browser/dev-check.mjs
  node browser/touch-check.mjs
  # the dev server (browser/serve.ts): a .ts save rebuilds the bundles and reloads the page, a .c save rebuilds the wasm,
  # a broken .c keeps the last good artefact and says why; on a temp copy of the tree (browser/serve-check.mjs)
  node browser/serve-check.mjs
  # ... and its hot re-mount: a bundle-only save re-imports the bundle and swaps the page over the same host (the canvas,
  # the wasm, the pointer, the document) on the page that opts in, with the state it keeps and the state it does not, next
  # to the same save as a reload, a .c save, a broken save, one frame loop after three re-mounts, and the two mutations
  # (skipped dispose, a false claim) that the check must kill (browser/hot-check.mjs, temp copy)
  node browser/hot-check.mjs
else
  echo "solid, in a browser: no zig, bun or Playwright chromium, skipped (sh browser/build.sh && bun browser/solid/build.ts && node browser/solid-check.mjs && node browser/sky-check.mjs && node browser/dialog-check.mjs && node browser/dev-check.mjs && node browser/ime-check.mjs && node browser/touch-check.mjs)"
  echo "solid, in a browser: no zig, bun or Playwright chromium, skipped (sh browser/build.sh && bun browser/solid/build.ts && node browser/solid-check.mjs && node browser/sky-check.mjs && node browser/input-check.mjs && node browser/dev-check.mjs && node browser/ime-check.mjs && node browser/touch-check.mjs)"
fi
# the panel's session file through the host's flag (`--tune`): one entry read before the first frame, and an unknown
# field failing with its entry and why (a non-zero exit, not a frame). The pick and the save key are the two tests' own.
printf '{"values":[{"id":"wifi","field":"radius","value":16}]}\n' > "${TMPDIR:-/tmp}/cssints-dev-tune.json"
$DEV --warm 30 --tune "${TMPDIR:-/tmp}/cssints-dev-tune.json" --png "${TMPDIR:-/tmp}/cssints-dev-tune.png"
printf '{"values":[{"id":"wifi","field":"radiusX","value":16}]}\n' > "${TMPDIR:-/tmp}/cssints-dev-tune-bad.json"
if $DEV --warm 1 --tune "${TMPDIR:-/tmp}/cssints-dev-tune-bad.json" --png "${TMPDIR:-/tmp}/cssints-dev-tune-bad.png" >/dev/null 2>&1; then
  echo "FAIL: a session with an unknown field did not fail"; exit 1
fi
# The Sky page's fourth screen (app/Notify.tsx over app/notify.ts): the app's notifications, opened with `n` on the feed
# or by the page's own `notify` entry (the C host's `--page notifications`). apps/csssky has no notifications screen or
# fixture, so the five rows are the app's recordings hand-carried — the app's five verbs over the recorded actors, posts
# and times (home-discover-1, home-science-1, thread.json) — and `notify.test.ts` holds each field's provenance, `n`, the
# rows and the ring, Tab's walk and its wrap, Enter on a post's thread and on a follow's nothing, Escape's frame, the
# entry and reduced motion, the a11y tree, the stored frame and the two deliberate breaks.
# `notify-initial.png` is the screen at rest (the feed's entry and the screen's are both over by `--warm 40`); in the
# browser it is the Sky page's own bundle (browser/solid/sky.ts, `n`), which browser/sky-check.mjs checks.
bun solid/main.ts notify --warm 40 --expect solid/frames/notify-initial.png
bun solid/notify.test.ts
# The Figure page: one glyph-kit spec (solid/specs/*.json) declared as Clay's boxes and texts, so its numbers are geometry
# — a bar is a track with a fill whose width is value/max. The stored frames are the page at rest; figure.test.ts
# reads every bar's fill back from the frame, and a growing funnel is refused with its sentence before a frame (a
# non-zero exit, and no PNG), as the other pages' bad input is.
bun solid/main.ts figure --spec solid/specs/bars.json --warm 30 --expect solid/frames/figure-bars.png
bun solid/main.ts figure --spec solid/specs/funnel.json --warm 30 --expect solid/frames/figure-funnel.png
# the two flow kinds: a branch flow's decisions and a state machine's path, stored as the page at rest
bun solid/main.ts figure --spec solid/specs/branch-flow.json --warm 30 --expect solid/frames/figure-branch-flow.png
bun solid/main.ts figure --spec solid/specs/state-machine.json --warm 30 --expect solid/frames/figure-state-machine.png
# the two row kinds: the tree's rows of boxes and the journey map's bars, words and notes, stored as the page at rest
bun solid/main.ts figure --spec solid/specs/tree.json --warm 30 --expect solid/frames/figure-tree.png
bun solid/main.ts figure --spec solid/specs/journey-map.json --warm 30 --expect solid/frames/figure-journey-map.png
# a directory of the figure's own, so a suite in another checkout beside this one cannot share these files
FIG="${TMPDIR:-/tmp}/cssints-figure"
mkdir -p "$FIG"
if bun solid/main.ts figure --spec solid/specs/invalid-funnel.json --png "$FIG/figure-invalid.png" \
  > "$FIG/figure-invalid.log" 2>&1; then
  echo "FAIL: a funnel that grows did not fail"; exit 1
fi
grep -q "a funnel never grows" "$FIG/figure-invalid.log" || {
  echo "FAIL: the growing funnel's refusal does not say why"; exit 1; }
if [ -f "$FIG/figure-invalid.png" ]; then echo "FAIL: an invalid spec wrote a frame"; exit 1; fi
echo "figure: thirteen stored frames are the page's, and a growing funnel is refused with its sentence before a frame"
# ... and the four design-system kinds, whose data is our own tokens: a palette's swatches and the mark of its first
# readable step, a contrast check's engine ratios and their verdicts, a spacing scale at its own pixel lengths and a type
# scale at its own sizes (a 40px row is three cells). One stored frame each, and the command goldens are figure.test.ts's.
bun solid/main.ts figure --spec solid/specs/palette.json --warm 30 --expect solid/frames/figure-palette.png
bun solid/main.ts figure --spec solid/specs/contrast.json --warm 30 --expect solid/frames/figure-contrast.png
bun solid/main.ts figure --spec solid/specs/colour-roles.json --warm 30 --expect solid/frames/figure-colour-roles.png
bun solid/main.ts figure --spec solid/specs/layer-stack.json --warm 30 --expect solid/frames/figure-layer-stack.png
bun solid/main.ts figure --spec solid/specs/state-matrix.json --warm 30 --expect solid/frames/figure-state-matrix.png
bun solid/main.ts figure --spec solid/specs/token-table.json --warm 30 --expect solid/frames/figure-token-table.png
bun solid/main.ts figure --spec solid/specs/spacing.json --warm 30 --expect solid/frames/figure-spacing.png
bun solid/main.ts figure --spec solid/specs/type-scale.json --warm 30 --expect solid/frames/figure-type-scale.png
bun solid/main.ts figure --spec solid/specs/sparkline.json --warm 30 --expect solid/frames/figure-sparkline.png; bun solid/main.ts figure --spec solid/specs/meter.json --warm 30 --expect solid/frames/figure-meter.png; bun solid/main.ts figure --spec solid/specs/heatmap.json --warm 30 --expect solid/frames/figure-heatmap.png
# ... and the chart half's fourth kind, forecast: this repository's own release cadence as columns, the next seven days
# at the trailing fortnight's mean inside its band (specs/from-releases.ts writes it, figure-handoff.sh cmps it)
bun solid/main.ts figure --spec solid/specs/forecast.json --warm 30 --expect solid/frames/figure-forecast.png
bun solid/main.ts figure --spec solid/specs/cohort.json --warm 30 --expect solid/frames/figure-cohort.png
# the generic table, the systems half's ninth kind: the Targets table of native/docs/map.md (specs/from-targets.ts
# writes it, figure-handoff.sh regenerates and cmps it), four columns and a cell cut to its column with `…`
bun solid/main.ts figure --spec solid/specs/table.json --warm 30 --expect solid/frames/figure-table.png
# ... and the three planning kinds, whose data is the map's own plan: the eight steps as a timeline on one axis, the
# status legend, and the Left: lists as a board. One stored frame each; the timeline is regenerated below and cmp'd.
bun solid/main.ts figure --spec solid/specs/timeline.json --warm 30 --expect solid/frames/figure-timeline.png
bun solid/main.ts figure --spec solid/specs/statusKey.json --warm 30 --expect solid/frames/figure-status-key.png
bun solid/main.ts figure --spec solid/specs/nowNextLater.json --warm 30 --expect solid/frames/figure-now-next-later.png
echo "figure: the map's plan — a timeline of its eight steps, the status key, and its Left: lists as a board (three stored frames)"
# the wireframe kinds: a page of this repository as its own boxes and text runs, one region of it with numbered
# callouts, and another page at two widths
bun solid/main.ts figure --spec solid/specs/screen.json --warm 30 --expect solid/frames/figure-screen.png
bun solid/main.ts figure --spec solid/specs/anatomy.json --warm 30 --expect solid/frames/figure-anatomy.png
bun solid/main.ts figure --spec solid/specs/modal.json --warm 30 --expect solid/frames/figure-modal.png
bun solid/main.ts figure --spec solid/specs/responsive-pair.json --warm 30 --expect solid/frames/figure-responsive-pair.png
# ... and the Sky page's own shell and cards: the bar, the feed and the status line as bands, and the feed's three post
# cards with the grid their boxes make (specs/from-frames.ts captures them, and figure-handoff.sh cmps the two specs)
bun solid/main.ts figure --spec solid/specs/app-shell.json --warm 30 --expect solid/frames/figure-app-shell.png
bun solid/main.ts figure --spec solid/specs/card-grid.json --warm 30 --expect solid/frames/figure-card-grid.png
# ... and the Sky page's wide form as a list beside a detail: the feed's column and the thread's, each the element the
# frame drew (720x760, the second card's thread open, settled: specs/from-frames.ts captures it and figure-handoff.sh cmps)
bun solid/main.ts figure --spec solid/specs/list-detail.json --warm 30 --expect solid/frames/figure-list-detail.png
echo "figure: the Widgets page's own frame as a wireframe, one part of it with callouts, the Sky page narrow and wide, and the Sky page's shell, cards and two panes (seven stored frames)"
# two of the four are regenerable from the data: specs/from-tokens.ts writes them from @cssints/tokens and the engine's
# contrast (packages/cssints/src/color.ts), so a token change that left the figure stale is this cmp, not a review note
bun solid/specs/from-tokens.ts "$FIG/specs" >/dev/null
cmp "$FIG/specs/palette.json" solid/specs/palette.json || {
  echo "FAIL: solid/specs/palette.json is not what specs/from-tokens.ts writes; commit its output"; exit 1; }
cmp "$FIG/specs/contrast.json" solid/specs/contrast.json || {
  echo "FAIL: solid/specs/contrast.json is not what specs/from-tokens.ts writes; commit its output"; exit 1; }
cmp "$FIG/specs/colour-roles.json" solid/specs/colour-roles.json || {
  echo "FAIL: solid/specs/colour-roles.json is not what specs/from-tokens.ts writes; commit its output"; exit 1; }
cmp "$FIG/specs/token-table.json" solid/specs/token-table.json || {
  echo "FAIL: solid/specs/token-table.json is not what specs/from-tokens.ts writes; commit its output"; exit 1; }
echo "figure: palette, contrast, colour-roles and token-table are regenerated from the tokens, byte for byte (cmp); spacing and type-scale are hand-written from apps/docs/src/tokens.json"
# the state matrix is the pages' own style modules: specs/from-styles.ts walks their s maps and the Sensors exports for
# a :hover/:focus/:active key, so a state added to a style is this cmp, not a review note
bun solid/specs/from-styles.ts "$FIG/specs" >/dev/null
cmp "$FIG/specs/state-matrix.json" solid/specs/state-matrix.json || {
  echo "FAIL: solid/specs/state-matrix.json is not what specs/from-styles.ts writes from the pages' styles; commit its output"; exit 1; }
echo "figure: state-matrix.json is regenerated from the pages' style modules, byte for byte (cmp)"
bun solid/specs/from-charts.ts "$FIG/specs" >/dev/null && cmp "$FIG/specs/meter.json" solid/specs/meter.json && cmp "$FIG/specs/heatmap.json" solid/specs/heatmap.json || { echo "FAIL: solid/specs/meter.json or heatmap.json is not what specs/from-charts.ts writes; commit its output"; exit 1; }
# the timeline is the map's own plan: specs/from-map.ts parses the step headings of native/docs/map.md, and this cmp is
# what makes a step added or renamed there a rewrite of the spec and not a stale figure. The board and the key are
# hand-written (the Left: lines are prose; figure-planning.test.ts holds them to it), so only the timeline is cmp'd.
mkdir -p "$FIG/specs-map"
bun solid/specs/from-map.ts "$FIG/specs-map" >/dev/null
cmp "$FIG/specs-map/timeline.json" solid/specs/timeline.json || {
  echo "FAIL: solid/specs/timeline.json is not what specs/from-map.ts writes from native/docs/map.md; commit its output"; exit 1; }
echo "figure: timeline.json is regenerated from native/docs/map.md's steps, byte for byte (cmp)"
# the three wireframe kinds' data is the pages' own frames: specs/from-page.ts captures the Widgets page with dump.ts and
# writes the boxes and texts, so a page edit that moved a box or a run is this cmp, not a review note
mkdir -p "$FIG/specs-page"
bun solid/specs/from-page.ts "$FIG/specs-page" >/dev/null
cmp "$FIG/specs-page/screen.json" solid/specs/screen.json || {
  echo "FAIL: solid/specs/screen.json is not what specs/from-page.ts captures of the Widgets page; commit its output"; exit 1; }
cmp "$FIG/specs-page/anatomy.json" solid/specs/anatomy.json || {
  echo "FAIL: solid/specs/anatomy.json is not what specs/from-page.ts captures; commit its output"; exit 1; }
cmp "$FIG/specs-page/responsive-pair.json" solid/specs/responsive-pair.json || {
  echo "FAIL: solid/specs/responsive-pair.json is not what specs/from-page.ts captures; commit its output"; exit 1; }
echo "figure: screen.json, anatomy.json and responsive-pair.json are from-page.ts's captures, byte for byte (cmp)"
# ... and the same figure in the browser: browser/solid/figure.ts fetches the same spec file, and browser/figure-check.mjs
# holds its commands to solid/goldens/figure.json (the desktop's frame, boxes within 4 px, Canvas2D's metrics) and a click
# to nothing. Its own guard, so the frames above still run on a machine without zig or Chromium
if command -v zig >/dev/null 2>&1 && command -v bun >/dev/null 2>&1 &&
   node -e 'process.exit(require("node:fs").existsSync(require("playwright").chromium.executablePath()) ? 0 : 1)' 2>/dev/null; then
  bun browser/solid/build.ts >/dev/null
  node browser/figure-check.mjs
  # the console page (browser/solid/console.ts): the Sensors page as the terminal's cells, printed with console.log.
  # console-check.mjs runs the terminal's own frames and holds the page to them cell for cell — at rest, after Tab and
  # after a press on the pill — and to the console's rule (20 frames at rest write no line) and a dark canvas
  node browser/console-check.mjs
else
  echo "figure, in a browser: no zig, bun or Playwright chromium, skipped (bun browser/solid/build.ts && node browser/figure-check.mjs)"
fi
# The text half of a figure (solid/src/figure/text.ts, solid/figure.ts): the docs draw themselves. The nine figures in
# native/README.md are the renderer's output from their specs, and a figure edited by hand is cmp's — the file and the
# line — before figure-text.test.ts's own comparison runs in native/test.sh. `--redraw` prints the document and writes
# nothing, so this check cannot change what it checks.
TEXTDOC="${TMPDIR:-/tmp}/cssints-figure-text-doc"
mkdir -p "$TEXTDOC"
bun solid/figure.ts --redraw README.md > "$TEXTDOC/README.md"
cmp "$TEXTDOC/README.md" README.md || {
  echo "FAIL: native/README.md's figures are not what 'bun solid/figure.ts --redraw README.md' draws; commit its output"; exit 1; }
echo "figure text: native/README.md's nine figures are the renderer's, byte for byte (cmp)"
# the four motion kinds' numbers are solid/src/motion.ts's own: specs/from-motion.ts writes them and cmps (a change to the spring is this line)
bun solid/specs/from-motion.ts --check
# ... and the motion half's three remaining kinds' stored frames: the card's frames are the Sky page's own group effects
# (from-frames.ts writes intent-card.json), the transition's two boxes are the Dialog's menu at the entry's start and at
# its settle (transition-spec.json, cmp'd with the five other frame-derived specs in figure-handoff.sh), and the easing
# table is the solver's progress at five points of each of the app's curves (from-motion.ts writes easing-table.json)
bun solid/main.ts figure --spec solid/specs/intent-card.json --warm 30 --expect solid/frames/figure-intent-card.png
bun solid/main.ts figure --spec solid/specs/transition-spec.json --warm 30 --expect solid/frames/figure-transition-spec.png
bun solid/main.ts figure --spec solid/specs/easing-table.json --warm 30 --expect solid/frames/figure-easing-table.png
echo "figure: the motion half's card, transition and easing table are three stored frames; their specs are the page's own frames and the solver's numbers"
# ... and the map draws its own plan: the same redraw, under the marker above the timeline's fence
bun solid/figure.ts --redraw docs/map.md > "$TEXTDOC/map.md"
cmp "$TEXTDOC/map.md" docs/map.md || {
  echo "FAIL: native/docs/map.md's timeline is not what 'bun solid/figure.ts --redraw docs/map.md' draws; commit its output"; exit 1; }
echo "figure text: native/README.md's nine figures and native/docs/map.md's timeline are the renderer's, byte for byte (cmp)"
# The export half (solid/src/figure/export/*, solid/figure-export.test.ts): the same layout as one standalone SVG and one
# self-contained page, with no host, no framework and no build step. The test holds every spec's SVG to the layout
# (well-formed XML, its texts in order, every x/width the layout's number), the page to one verbatim SVG and no script,
# Chromium's boxes to the SVG's numbers within 1 px, and two runs to `cmp`. The two shipped files below are regenerated
# here and compared, so a figure cannot drift from its spec — the same discipline as the text half.
bun solid/figure-export.test.ts
bun solid/figure.ts solid/specs/palette.json --html "$FIG/palette.html"
bun solid/figure.ts solid/specs/pipeline.json --svg "$FIG/pipeline.svg"
cmp "$FIG/palette.html" docs/exports/palette.html || {
  echo "FAIL: docs/exports/palette.html is not what 'bun solid/figure.ts solid/specs/palette.json --html' writes; commit its output"; exit 1; }
cmp "$FIG/pipeline.svg" docs/exports/pipeline.svg || {
  echo "FAIL: docs/exports/pipeline.svg is not what 'bun solid/figure.ts solid/specs/pipeline.json --svg' writes; commit its output"; exit 1; }
echo "figure export: every spec's SVG and page are the layout's (165 checks), and docs/exports/{palette.html,pipeline.svg} are regenerated and cmp'd"
# ... and the three forms a review needs, on the same layout and no second drawer: a **deck** (`--deck`, one self-
# contained page with a slide a spec, `:target` navigation and an `@page`/`break-after` print that is a page a slide), a
# **raster** (`--png`, the desktop host's own frame through `bun solid/main.ts figure --png`, at `--scale 1` and `2`:
# `--density` is the pixel count, so 2x is the layout at twice the pixels) and a **PDF** (`--pdf`, the deck printed by
# Playwright's Chromium, a page a slide, the text still text). `figure-export-deck.test.ts` counts the slides and the
# `<svg>`s and holds each slide to `svg(spec)` verbatim, refuses a `<script>`, opens the file in Chromium (one slide at
# a time, every slide inside the printable box of the PDF's own page size), counts `page.pdf()`'s pages, reads every
# title back out of the PDF's glyph streams through each font's ToUnicode map, checks the 2x raster against the 1x one,
# `cmp`s two runs of each, and mutates the deck (a repeated figure), the print CSS (one page) and the 2x raster (the 1x
# size). The three shipped files are regenerated here and compared, as the two above are.
bun solid/figure-export-deck.test.ts
bun solid/figure.ts solid/specs/palette.json solid/specs/bars.json solid/specs/timeline.json \
  --deck -o "$FIG/review.html" --title "The review: a palette, a frame and the plan"
cmp "$FIG/review.html" docs/exports/review.html || {
  echo "FAIL: docs/exports/review.html is not what 'bun solid/figure.ts palette.json bars.json timeline.json --deck' writes; commit its output"
  exit 1; }
bun solid/figure.ts --png solid/specs/bars.json -o "$FIG/bars.png" --scale 1
cmp "$FIG/bars.png" docs/exports/bars.png || {
  echo "FAIL: docs/exports/bars.png is not what 'bun solid/figure.ts --png solid/specs/bars.json --scale 1' writes it; commit its output"
  exit 1; }
bun solid/figure.ts --png solid/specs/bars.json -o "$FIG/bars@2x.png" --scale 2
cmp "$FIG/bars@2x.png" docs/exports/bars@2x.png || {
  echo "FAIL: docs/exports/bars@2x.png is not what 'bun solid/figure.ts --png solid/specs/bars.json --scale 2' writes it; commit its output"
  exit 1; }
# ... and the PDF from the CLI itself, a page a slide (`page.pdf()` is behind it; the test above is the check)
bun solid/figure.ts solid/specs/palette.json solid/specs/bars.json solid/specs/timeline.json \
  --pdf -o "$FIG/review.pdf"
echo "figure export: the deck (3 slides), its PDF (3 pages) and the raster at 1x and 2x (400x112, 800x224); docs/exports/{review.html,bars.png,bars@2x.png} are regenerated and cmp'd"
sh solid/figure-handoff.sh
