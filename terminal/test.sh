#!/bin/sh
# Step 6, the Solid half: one page as Solid on the terminal. `solid/native/term.c` is Clay over terminal/cells.c,
# render.c, measure.c and termbox2 (build/solid/libterm.dylib), `terminal/solid.ts` is solid/main.ts's loop shape on it,
# and the page is `solid/app/Sensors.tsx` unmodified: the host re-cuts page.c's two lengths for cells through the value
# channel (the root's padding and gap, the pill's height) and draws the pill's ring from its own focus, as page.c's
# `pill_style(focused)` does.
#
# The C page is the oracle. At the page's own height (11 cells: the C page's list starts on row 12) the Solid frame is
# the C frame byte for byte, as a dump and as ANSI, dark and light, and after Tab and ArrowDown. At the suite's 20 rows
# the page's first 11 rows are the same and the rows below are the C page's list and footer, which Sensors.tsx does not
# draw: that gap is the one this slice does not close, and the last comparison counts the rows it does.
#
# Runs on its own (from any directory) and from native/test.sh, which calls it after the C page's own checks.
set -e
cd "$(dirname "$0")/.."
OUT="${NATIVE_OUT:-${TMPDIR:-/tmp}/cssints-terminal-solid}"
mkdir -p "$OUT"
[ -x ./terminal/demo ] || sh terminal/build.sh >/dev/null
sh solid/native/build.sh >/dev/null
SOLID="bun terminal/solid.ts"
ESC=$(printf '\033')
n=0
identical() { n=$((n + 1)); echo "solid, terminal: $1 -> identical"; }

# the page's own frame, in the two themes, and after the focus leaves the pill: one Bun start each (the page's styles and
# its .tsx are compiled by child processes, which is most of a run), and every frame the run makes is written beside it
rm -f "$OUT"/solid-dark.* "$OUT"/solid-light.* "$OUT"/solid-20.* "$OUT"/solid-click.*
$SOLID --cols 80 --rows 11 --keys Tab,ArrowDown --frames-out "$OUT/solid-dark"
./terminal/demo --cols 80 --rows 11 --dump "$OUT/term-page-dark.txt"
cmp "$OUT/solid-dark.0.txt" "$OUT/term-page-dark.txt" || {
  echo "FAIL: the Solid page's dark frame is not the C page's (80x11 cells)"; exit 1; }
identical "the page's frame, dark, is the C page's own (80x11 cells)"
./terminal/demo --cols 80 --rows 11 --keys Tab,ArrowDown --dump "$OUT/term-page-focus.txt"
cmp "$OUT/solid-dark.2.txt" "$OUT/term-page-focus.txt" || {
  echo "FAIL: the Solid frame after Tab,ArrowDown is not the C page's"; exit 1; }
identical "after Tab and ArrowDown (the ring off the pill, nowhere to go) the frame is the C page's own"
# ... and the stored focus frame's own rows: at 20 rows the C page's ring is the list's, on row 12, so the page's 11
# rows are expected-focus.txt's 11
head -11 terminal/expected-focus.txt > "$OUT/solid-focus-head.txt"
head -11 "$OUT/solid-dark.2.txt" > "$OUT/solid-focus-got.txt"
cmp "$OUT/solid-focus-got.txt" "$OUT/solid-focus-head.txt" || {
  echo "FAIL: the Solid frame after Tab,ArrowDown is not expected-focus.txt's first 11 rows"; exit 1; }
identical "and the page's rows are expected-focus.txt's own (the C page's ring is the list's, on row 12)"
# the ANSI path too: the same cells, the truecolour SGR, the runs merged
./terminal/demo --cols 80 --rows 11 --ansi "$OUT/term-page-dark.ansi"
cmp "$OUT/solid-dark.0.ansi" "$OUT/term-page-dark.ansi" || {
  echo "FAIL: the Solid frame's ANSI is not the C page's"; exit 1; }
identical "its ANSI is the C page's own (truecolour, SGR runs merged)"
# ... and the ANSI's own two properties, as the C page's test checks them: a truecolour ink, and a fill that is one
# escape a row rather than one a cell (3 rows of 25 cells = 3)
grep -qF "${ESC}[38;2;230;60;60m" "$OUT/solid-dark.0.ansi" || {
  echo "FAIL: the Solid ANSI has no red title (38;2;230;60;60)"; exit 1; }
runs=$(grep -oF "${ESC}[48;2;36;40;52m" "$OUT/solid-dark.0.ansi" | wc -l | tr -d ' ')
[ "$runs" = 3 ] || {
  echo "FAIL: the pill's surface background has $runs SGR runs, want 3 (merged, not one a cell)"; exit 1; }
identical "the pill's fill is 3 SGR runs (one a row, not one a cell) and the title is 38;2;230;60;60"

$SOLID --cols 80 --rows 11 --theme light --frames-out "$OUT/solid-light"
./terminal/demo --cols 80 --rows 11 --theme light --dump "$OUT/term-page-light.txt"
cmp "$OUT/solid-light.0.txt" "$OUT/term-page-light.txt" || {
  echo "FAIL: the Solid page's light frame is not the C page's (80x11 cells)"; exit 1; }
identical "the same in the light theme (the theme variant, folded by the same styles.ts)"

# the suite's own size: 20 rows, where the C page's list (rows 12 to 17) and the footer (row 18) are Solid's gap. The
# page's rows are the stored frame's rows, byte for byte; the difference is counted, not hidden
$SOLID --cols 80 --rows 20 --keys Tab,ArrowDown --dump "$OUT/solid-20.txt"
head -11 terminal/expected-dark.txt > "$OUT/solid-20-head.txt"
head -11 "$OUT/solid-20.txt" > "$OUT/solid-20-got.txt"
cmp "$OUT/solid-20-got.txt" "$OUT/solid-20-head.txt" || {
  echo "FAIL: the Solid page's rows at 20 rows are not expected-dark.txt's first 11"; exit 1; }
identical "at 80x20 the page's 11 rows are expected-dark.txt's own (rows 12-19 are the C page's list, not the page's)"
page_rows=$(wc -l < "$OUT/solid-20-got.txt" | tr -d ' ')
echo "solid, terminal: the page is $page_rows of the C page's 20 rows; rows 12-19 ($((20 - page_rows)) rows, 9 x 80 cells) are terminal/page.c's list and footer, which Sensors.tsx does not have"

# the page is live: a press on the pill is the page's own onClick, so Units flips and the label, the values and the
# magnitude change with it; the pointer stays on the pill, so the pill is hovered (termbox2 reports no motion, so only a
# press moves the pointer)
$SOLID --cols 80 --rows 12 --click 40,9 --frames-out "$OUT/solid-click"
grep -q "switch to m/s²" "$OUT/solid-click.3.txt" || {
  echo "FAIL: a click on the Units pill did not flip the page to g"; exit 1; }
grep -q "accel g" "$OUT/solid-click.3.txt" || { echo "FAIL: the click did not change the caption"; exit 1; }
grep -qF "${ESC}[48;2;48;53;68m" "$OUT/solid-click.3.ansi" || {
  echo "FAIL: a click leaves the pointer on the pill, whose hover fill is 48,53,68"; exit 1; }
identical "a click on the pill flips Units through the page's own onClick (hover fill 48,53,68, as a mouse leaves it)"

# termbox2: the live binding needs a terminal -- tb_init opens /dev/tty -- so it runs under a pty, one frame and out (a
# screen, as main.c's --frames 1). Truecolour, because COLORTERM says the terminal has it
if command -v script >/dev/null 2>&1; then
  rm -f "$OUT/solid-live.log"
  script -q "$OUT/solid-live.log" sh -c "stty rows 24 cols 80; COLORTERM=truecolor bun terminal/solid.ts --frames 2" >/dev/null 2>&1
  grep -q "terminal: 2 frames, 80x24" "$OUT/solid-live.log" || {
    echo "FAIL: termbox2 drew no frame from the Solid host"; exit 1; }
  grep -qF "${ESC}[38;2;" "$OUT/solid-live.log" || { echo "FAIL: the live frame wrote no truecolour SGR"; exit 1; }
  identical "termbox2 drew the Solid page's screen (80x24, truecolour) under a pty"
else
  echo "solid, terminal: no script(1), the termbox2 screen check skipped"
fi

# ---- the Figure page, the terminal host's third page: one spec, the layout's own cells --------------------------
# solid/specs/bars.json is the desktop's own file, and solid/src/figure/kinds.ts speaks cells, so the host re-cuts no
# length: a figure written in cells is the cell grid's own shape. A focus line reads without colour (`►`), as the kit's.
# A directory of the figure's own, so a suite running in another checkout beside this one cannot share its dumps.
FIG="${TMPDIR:-/tmp}/cssints-figure-terminal"
mkdir -p "$FIG"
$SOLID --page figure --spec solid/specs/bars.json --cols 60 --rows 7 --dump "$FIG/solid-figure.txt"
grep -q "A frame, by target" "$FIG/solid-figure.txt" || { echo "FAIL: the figure page drew no title"; exit 1; }
grep -q "desktop" "$FIG/solid-figure.txt" || { echo "FAIL: the figure page drew no bar row"; exit 1; }
identical "the figure page (bars.json): the title and the rows, the layout's own cells"
$SOLID --page figure --spec solid/specs/funnel.json --cols 70 --rows 9 --dump "$FIG/solid-figure-funnel.txt"
grep -q "► One in twenty visitors pays." "$FIG/solid-figure-funnel.txt" || {
  echo "FAIL: the funnel's focus line (► and its words) is not in the cells"; exit 1; }
grep -q "signed up" "$FIG/solid-figure-funnel.txt" || { echo "FAIL: the funnel drew no step"; exit 1; }
identical "the funnel spec: its steps and its focus line with ►, so the point reads without colour"
# the two flow kinds, the same layout the desktop draws: the branch's ASCII run and a path's transition words
$SOLID --page figure --spec solid/specs/branch-flow.json --cols 80 --rows 20 --dump "$FIG/solid-figure-branch.txt"
grep -q "One spec, from its file to a frame" "$FIG/solid-figure-branch.txt" || {
  echo "FAIL: the branch flow drew no title"; exit 1; }
grep -q -e '-- no -->' "$FIG/solid-figure-branch.txt" || { echo "FAIL: the branch's connector is not in the cells"; exit 1; }
identical "the branch flow: a column of boxes, the branch to the right, and its no connector"
$SOLID --page figure --spec solid/specs/state-machine.json --cols 80 --rows 20 --dump "$FIG/solid-figure-state.txt"
grep -q "A dialog's presence, one open" "$FIG/solid-figure-state.txt" || {
  echo "FAIL: the state machine drew no title"; exit 1; }
grep -q "| settled" "$FIG/solid-figure-state.txt" || { echo "FAIL: a transition's word is not in the cells"; exit 1; }
identical "the state machine: the path's boxes and each transition's word between them"
# the two row kinds: the tree's levels are rows of boxes with the | - + connectors between them, and a journey stage is
# a bar row with the stage's doing and thinking under it
$SOLID --page figure --spec solid/specs/tree.json --cols 80 --rows 13 --dump "$FIG/solid-figure-tree.txt"
grep -q "The targets and their pages" "$FIG/solid-figure-tree.txt" || {
  echo "FAIL: the tree drew no title"; exit 1; }
grep -q "one UI, many targets" "$FIG/solid-figure-tree.txt" || { echo "FAIL: the tree drew no root"; exit 1; }
grep -q -F -- '+---' "$FIG/solid-figure-tree.txt" || {
  echo "FAIL: the tree's bracket is not in the cells"; exit 1; }
for node in desktop terminal browser board sensors figure sky; do
  grep -q "$node" "$FIG/solid-figure-tree.txt" || { echo "FAIL: the tree's row has no $node"; exit 1; }
done
identical "the tree: the root, the four targets in one row and their pages in the next, with | - + connectors"
$SOLID --page figure --spec solid/specs/journey-map.json --cols 80 --rows 13 --dump "$FIG/solid-figure-journey.txt"
grep -q "The first week, in three stages" "$FIG/solid-figure-journey.txt" || {
  echo "FAIL: the journey map drew no title"; exit 1; }
grep -q "+2 great" "$FIG/solid-figure-journey.txt" || { echo "FAIL: no stage's feeling is in the cells"; exit 1; }
grep -q -- "-2 bad" "$FIG/solid-figure-journey.txt" || { echo "FAIL: the bad stage's word is not in the cells"; exit 1; }
grep -q "Why did my dates break?" "$FIG/solid-figure-journey.txt" || {
  echo "FAIL: a stage's thinking is not under its bar"; exit 1; }
identical "the journey map: a bar a stage, its feeling's word, and the stage's doing and thinking under it"
# the two wireframe kinds: the Widgets page's own command stream cut to the cell grid (its boxes as + - | and its own
# runs in its words), and the Sky page at 240 and 360px side by side, each side captioned with its size
$SOLID --page figure --spec solid/specs/screen.json --cols 104 --rows 52 --dump "$FIG/solid-figure-screen.txt"
grep -q "The Widgets page, as a wireframe" "$FIG/solid-figure-screen.txt" || {
  echo "FAIL: the screen drew no title"; exit 1; }
grep -q -F -- "+---" "$FIG/solid-figure-screen.txt" || { echo "FAIL: the screen drew no box edge"; exit 1; }
grep -q "Wi-Fi" "$FIG/solid-figure-screen.txt" || { echo "FAIL: the screen drew none of the page's runs"; exit 1; }
identical "the screen: the Widgets page's own boxes and runs, 45 cells of its 360px"
$SOLID --page figure --spec solid/specs/responsive-pair.json --cols 100 --rows 53 --dump "$FIG/solid-figure-pair.txt"
grep -q "The Sky page, at two widths" "$FIG/solid-figure-pair.txt" || {
  echo "FAIL: the pair drew no title"; exit 1; }
grep -q "narrow 240x760" "$FIG/solid-figure-pair.txt" || { echo "FAIL: the pair has no narrow caption"; exit 1; }
grep -q "wide 360x760" "$FIG/solid-figure-pair.txt" || { echo "FAIL: the pair has no wide caption"; exit 1; }
identical "the responsive pair: the Sky page at 240 and 360px, side by side (30 + 2 + 45 cells)"
# the three planning kinds, the map's own plan: a timeline (its spans, its numbers and the axis's ends), the status key's
# three words and sentences, and the board's three columns of cards
$SOLID --page figure --spec solid/specs/timeline.json --cols 80 --rows 13 --dump "$FIG/solid-figure-timeline.txt"
grep -q "The plan's order, one step a row" "$FIG/solid-figure-timeline.txt" || {
  echo "FAIL: the timeline drew no title"; exit 1; }
grep -q "0 step" "$FIG/solid-figure-timeline.txt" || { echo "FAIL: the timeline's axis has no start"; exit 1; }
grep -q "7–8 step" "$FIG/solid-figure-timeline.txt" || { echo "FAIL: the timeline's last step is not in the cells"; exit 1; }
identical "the timeline: a step a row, its span in cells, and the axis's two ends under it"
$SOLID --page figure --spec solid/specs/statusKey.json --cols 80 --rows 7 --dump "$FIG/solid-figure-status-key.txt"
grep -q "What the map's statuses mean" "$FIG/solid-figure-status-key.txt" || {
  echo "FAIL: the status key drew no title"; exit 1; }
for status in Done Left Blocked; do
  grep -q "\. $status" "$FIG/solid-figure-status-key.txt" || { echo "FAIL: no $status row in the key"; exit 1; }
done
identical "the status key: a mark and its word a status, with the sentence beside it"
$SOLID --page figure --spec solid/specs/nowNextLater.json --cols 80 --rows 40 --dump "$FIG/solid-figure-board.txt"
grep -q "What the map has left, now, next, later" "$FIG/solid-figure-board.txt" || {
  echo "FAIL: the board drew no title"; exit 1; }
for column in NOW NEXT LATER; do
  grep -q "$column" "$FIG/solid-figure-board.txt" || { echo "FAIL: the board has no $column column"; exit 1; }
done
grep -q "termbox2 reports no" "$FIG/solid-figure-board.txt" || {
  echo "FAIL: the board's now column has no card"; exit 1; }
identical "the board: three columns of cards, a card's words wrapped in its column"
# a press on a figure is nothing: the page declares no control of its own
$SOLID --page figure --spec solid/specs/funnel.json --cols 70 --rows 9 --dump "$FIG/solid-figure-base.txt"
$SOLID --page figure --spec solid/specs/funnel.json --cols 70 --rows 9 --click 20,4 --dump "$FIG/solid-figure-click.txt"
cmp "$FIG/solid-figure-base.txt" "$FIG/solid-figure-click.txt" || {
  echo "FAIL: a click on the figure changed its cells"; exit 1; }
identical "a click on the figure changes nothing (no control, no state)"
sh terminal/figure-handoff.sh
for s in motion-timing easing stagger frame-strip; do $SOLID --page figure --spec "solid/specs/$s.json" --cols 80 --rows 40 --dump "$FIG/solid-figure-$s.txt" && [ -s "$FIG/solid-figure-$s.txt" ] || { echo "FAIL: the motion figure $s drew no cells"; exit 1; }; done; identical "the four motion kinds' cells (motion-timing, easing, stagger, frame-strip)"
for s in sparkline meter heatmap; do $SOLID --page figure --spec "solid/specs/$s.json" --cols 80 --rows 40 --dump "$FIG/solid-figure-$s.txt" && [ -s "$FIG/solid-figure-$s.txt" ] || { echo "FAIL: the chart figure $s drew no cells"; exit 1; }; done; identical "the three chart kinds' cells (sparkline, meter, heatmap)"

# the cost: the frame (declare + Clay + the commands into cells) and the same cells as ANSI, on this machine
bench=$($SOLID --bench 20)
echo "$bench"
case "$bench" in
  *"ms a frame"*) ;;
  *) echo "FAIL: --bench printed no frame time"; exit 1 ;;
esac
dylib=$(ls -l build/solid/libterm.dylib | awk '{ print $5 }')
echo "solid, terminal: $((dylib / 1024)) KB of libterm.dylib (Clay, cells.c, render.c, measure.c, termbox2)"
echo "solid, terminal: $n comparisons, all identical, and the two numbers above"

# ---- the Sky feed, the terminal host's second page ---------------------------------------------------------------
# `solid/app/Sky.tsx`: the bar with the tablist, the feed the page scrolls itself, the status line. Its data is the app's
# **recordings**, handed to the page as the app's own calls (`terminal/data.ts`: `homeScreen` at a cursor, the recorded
# thread for a card's `load`), so the feed is the app's pages — `home-discover-1`/`2` and `home-science-1` — and not a
# fixture transcribed in the page. This block is the frame, its focus and its scroll; the next one is the data, the
# paging and the states. The C feed (terminal/sky.c) is the behaviour's oracle, not the cells': the C card has a hand-cut
# border and separator, its name and meta share one row, its body is one clipped row, its counts are the glyphs `↩ ⟲ ♥`,
# it draws no avatar and its footer is the key hints; the Solid card has one cell of side padding and no border at rest,
# its meta is its own row, its body wraps at words, its counts are words, its avatar is an image the host skips, and its
# footer is the page's status line. So the two frames are not identical: this block stores the Solid frame as its own
# guard and counts the distance.
rm -f "$OUT"/solid-sky* "$OUT"/c-sky*
$SOLID --page sky --cols 80 --rows 20 --dump "$OUT/solid-sky.txt"
cmp "$OUT/solid-sky.txt" terminal/expected-solid-sky.txt || {
  echo "FAIL: the Solid Sky feed at 80x20 is not terminal/expected-solid-sky.txt"; exit 1; }
identical "the Sky feed's frame is terminal/expected-solid-sky.txt (80x20 cells, the page's own guard, page 1)"
# the rows are the recording's, in the app's order: the app's own moderation rule (`postVerdict`) picks the page's posts
# and the page maps each through its `postOf`, so the labels a cell carries are the recording's authors. Printed: the
# label and the row it landed on, and the recording's visible count — which is the status line's number.
feed_rows() {
  bun -e '
import { postVerdict } from "../apps/csssky/src/api.ts";
import { readFileSync } from "node:fs";
const [fixture, dump, n] = process.argv.slice(1);
const answer = JSON.parse(readFileSync(fixture, "utf8"));
const rows = readFileSync(dump, "utf8").split("\n");
const cards = answer.feed.filter((i) => postVerdict(i.post) !== "hide")
  .map((i) => i.post.author.displayName || i.post.author.handle);
const shown = cards.slice(0, +n);
const at = shown.map((name) => rows.findIndex((r) => r.includes(name)));
if (at.some((y, i) => y < 0 || (i > 0 && y <= at[i - 1]))) {
  console.error("FAIL: the frame rows are not the recording order: " + shown.join(", ") + " at " + at.join(","));
  process.exit(1);
}
console.log(shown.map((name, i) => name + " (row " + at[i] + ")").join(" | ") + "; " + cards.length + " visible");
' "$1" "$2" "$3"
}
feed_rows ../apps/csssky/test/fixtures/home-discover-1.json "$OUT/solid-sky.txt" 3
grep -q "Discover — 28 posts" "$OUT/solid-sky.txt" || {
  echo "FAIL: the feed's count is not the recording's 28 visible posts"; exit 1; }
identical "the first page's rows are home-discover-1's: the recording's authors, in order, and its 28 visible posts"
$SOLID --page sky --cols 80 --rows 20 --keys Tab,ArrowRight --settle 4 --dump "$OUT/solid-sky-focus.txt"
cmp "$OUT/solid-sky-focus.txt" terminal/expected-solid-sky-focus.txt || {
  echo "FAIL: the Solid Sky feed after Tab,ArrowRight is not terminal/expected-solid-sky-focus.txt"; exit 1; }
identical "after Tab and ArrowRight (the bar focused, Science) it is expected-solid-sky-focus.txt, the C focus frame's twin"
grep -q "Science — 25 posts" "$OUT/solid-sky-focus.txt" || {
  echo "FAIL: ArrowRight on the tablist did not switch the feed (the status line is not Science's 25 posts)"; exit 1; }
grep -q "Michael Warburton" "$OUT/solid-sky-focus.txt" && {
  echo "FAIL: the tab switch showed Science but left Discover's first post"; exit 1; }
feed_rows ../apps/csssky/test/fixtures/home-science-1.json "$OUT/solid-sky-focus.txt" 1
identical "and the tab switch is the page's: ArrowRight shows Science's own page 1 (25 of its 30 recorded), Discover's gone"

# the focus order: the tablist is the first stop, on the active tab, and a cell's tab focus is the C bar's active tab (the
# accent fill and an on-accent label), because a 2px border on a one-row tab is the label's own row; the feed is the second
# stop and its `:focus` ring is the page's ring token, one cell of box characters around the viewport
$SOLID --page sky --cols 80 --rows 20 --keys Tab --ansi "$OUT/solid-sky-tab.ansi" --dump "$OUT/solid-sky-tab.txt"
grep -qF "${ESC}[48;2;59;156;240m" "$OUT/solid-sky-tab.ansi" || {
  echo "FAIL: Tab reaches the tablist but the active tab has no accent fill (48;2;59;156;240)"; exit 1; }
grep -qF "${ESC}[38;2;255;255;255m" "$OUT/solid-sky-tab.ansi" || {
  echo "FAIL: the focused tab's label is not the on-accent white (38;2;255;255;255)"; exit 1; }
grep -q "Discover" "$OUT/solid-sky-tab.txt" || { echo "FAIL: the focused tab lost its label"; exit 1; }
identical "Tab is the tablist: the active tab wears the accent fill and a white label (the C bar's active tab, not its ring)"
$SOLID --page sky --cols 80 --rows 20 --keys Tab,Tab --ansi "$OUT/solid-sky-feed.ansi" --dump "$OUT/solid-sky-feed.txt"
grep -qF "${ESC}[38;2;92;176;255m" "$OUT/solid-sky-feed.ansi" || {
  echo "FAIL: Tab,Tab gives the feed no ring (the page's 92,176,255 border)"; exit 1; }
grep -q "┌" "$OUT/solid-sky-feed.txt" || { echo "FAIL: the feed's ring is not drawn in box characters"; exit 1; }
identical "Tab again is the feed: its focus ring is the page's 92,176,255 border, one cell around the viewport"

# the feed's own scroll (solid/src/vscroll.ts): ArrowDown 40px, PageDown a viewport, the wheel a 10px notch. With the
# recording's page the feed is long (28 cards, 6184px of scroll at 80x20), so nothing here lands on an end by accident:
# a key moves its own step, and the end is an `End` (and the next page) away — the data block below.
$SOLID --page sky --cols 80 --rows 20 --keys Tab,Tab,ArrowDown --settle 40 --offset --dump "$OUT/solid-sky-20down.txt" |
  tee "$OUT/solid-sky-20down.log"
grep -q "offset -40 px (-2.50 rows)" "$OUT/solid-sky-20down.log" || {
  echo "FAIL: ArrowDown did not move the feed 40px at 80x20"; exit 1; }
$SOLID --page sky --cols 80 --rows 20 --keys Tab,Tab,PageDown --settle 40 --offset --dump "$OUT/solid-sky-20page.txt" |
  tee "$OUT/solid-sky-20page.log"
grep -q "offset -288 px (-18.00 rows)" "$OUT/solid-sky-20page.log" || {
  echo "FAIL: PageDown did not move the feed one viewport (288px) at 80x20"; exit 1; }
$SOLID --page sky --cols 80 --rows 20 --keys Tab,Tab,WheelDown --settle 40 --offset --dump "$OUT/solid-sky-20wheel.txt" |
  tee "$OUT/solid-sky-20wheel.log"
grep -q "offset -10 px (-0.63 rows)" "$OUT/solid-sky-20wheel.log" || {
  echo "FAIL: one wheel notch did not move the feed 10px at 80x20"; exit 1; }
identical "ArrowDown is 40px, PageDown a viewport (288px) and the wheel a 10px notch, on the long recorded feed"

# the scroll the C page can compare: at 80x12 both pages scroll to their third post. The C page's list holds no offset —
# scroll_into re-declares from the selected card — and the Solid page's track moves one viewport (160px, 10 rows); the
# states and the row/cell count below are the comparison.
./terminal/demo --page sky --cols 80 --rows 12 --keys ArrowDown,ArrowDown --dump "$OUT/c-sky-12-down.txt"
grep -q "Michael Warburton" "$OUT/c-sky-12-down.txt" && {
  echo "FAIL: the C page's list did not scroll past its first post"; exit 1; }
grep -q "alexjungle" "$OUT/c-sky-12-down.txt" || {
  echo "FAIL: the C page's list did not show its third post"; exit 1; }
$SOLID --page sky --cols 80 --rows 12 --keys Tab,Tab,PageDown --settle 60 --offset --dump "$OUT/solid-sky-12.txt" |
  tee "$OUT/solid-sky-12.log"
grep -q "offset -160 px (-10.00 rows)" "$OUT/solid-sky-12.log" || {
  echo "FAIL: PageDown did not move the feed one 10-row viewport (160px) at 80x12"; exit 1; }
grep -q "Ron Filipkowski" "$OUT/solid-sky-12.txt" && {
  echo "FAIL: the Solid feed did not scroll past its first post (Ron Filipkowski is still visible)"; exit 1; }
grep -q "Molecular Jackhammer" "$OUT/solid-sky-12.txt" || {
  echo "FAIL: the Solid feed did not scroll to a later post's body"; exit 1; }
identical "the feed scrolls one viewport at 80x12 (10 rows), as the C list scrolls to its third post (one card at a time)"

# a card's own onClick: a click on the body opens the thread screen (Enter on the feed presses the first card's own onClick
# in the thread's block below; the page's cards are not Tab stops, so Enter has no card of its own). The host's `load`
# settles the screen with the app's recorded thread a frame after it mounts, so the frame the click's release makes is
# still the loading row (`--settle 1`), and the app's rows are the frame after it
$SOLID --page sky --cols 80 --rows 20 --click 20,4 --settle 1 --dump "$OUT/solid-sky-open.txt"
thread_opened() {
  grep -q "Loading the thread…" "$1" || {
    echo "FAIL: a click on a card did not open its thread's loading state"; return 1; }
  return 0
}
thread_opened "$OUT/solid-sky-open.txt" || exit 1
identical "a click on a card runs the page's own onClick: the thread screen opens in its loading state"

# the C feed is the oracle of behaviour, not of cells: the row-by-row distance at rest, after the tab switch, and after the
# scroll. `sky_diff` counts code points, one a cell, over the 80 columns: rows, cells, the worst row.
sky_diff() {
  node -e '
    const fs = require("fs");
    const [a, b, n] = process.argv.slice(1);
    const read = (p) => fs.readFileSync(p, "utf8").split("\n").slice(0, +n);
    const A = read(a), B = read(b);
    const per = [];
    let cells = 0, same = 0, worst = 0, wv = 0;
    for (let y = 0; y < +n; y++) {
      const p = [...(A[y] ?? "")].slice(0, 80), q = [...(B[y] ?? "")].slice(0, 80);
      while (p.length < 80) p.push(" ");
      while (q.length < 80) q.push(" ");
      let d = 0;
      for (let x = 0; x < 80; x++) if (p[x] !== q[x]) d++;
      cells += d;
      if (!d) same++;
      if (d > wv) (wv = d), (worst = y);
      per.push(d);
    }
    console.log(cells + " cells, " + same + " of " + n + " rows the same, the worst row " + worst + " (" + wv + " of 80); rows " + per.join(","));
  ' "$1" "$2" "$3"
}
base=$(sky_diff terminal/expected-sky.txt "$OUT/solid-sky.txt" 20)
echo "solid, terminal: the Sky feed against terminal/expected-sky.txt (the C feed): $base"
case "$base" in
  "1475 cells, 0 of 20 rows the same, the worst row 1 (80 of 80);"*) ;;
  *) echo "FAIL: the Sky feed's row/cell distance from the C feed changed (expected 1475 cells, row 1 the worst)"; exit 1 ;;
esac
science=$(sky_diff terminal/expected-sky-focus.txt "$OUT/solid-sky-focus.txt" 20)
echo "solid, terminal: after the tab switch against terminal/expected-sky-focus.txt: $science"
case "$science" in
  "1399 cells, 0 of 20 rows the same, the worst row 1 (80 of 80);"*) ;;
  *) echo "FAIL: the Science frame's row/cell distance from the C feed changed (expected 1399 cells)"; exit 1 ;;
esac
scrolled=$(sky_diff "$OUT/c-sky-12-down.txt" "$OUT/solid-sky-12.txt" 12)
echo "solid, terminal: after the scroll against the C list's scrolled frame (80x12): $scrolled"
case "$scrolled" in
  "684 cells, 0 of 12 rows the same, the worst row 6 (80 of 80);"*) ;;
  *) echo "FAIL: the scrolled frame's row/cell distance from the C list changed (expected 684 cells, row 6 the worst)"; exit 1 ;;
esac
echo "solid, terminal: no row is identical to the C feed's: its bar labels carry '1/2/3' and its padding, its six separator"
echo "solid, terminal: rows (the card borders) and its key-hint footer have no counterpart, and its body rows are one clipped"
echo "solid, terminal: row where the page wraps. The nearest rows are the bar (row 0: 32 of 80), a body line at the same"
echo "solid, terminal: words and a one-cell inset (Science's row 5 and row 10: 8 of 80) and the counts' words (row 4: 67)."

# the two mutations this slice has to catch. `--mutate scroll` drops the page's offset before Clay (term_scroll_to 0): the
# feed stays at row 0, and the scrolling check's own message fails. `--mutate tab` never flushes the frame the tab key lands
# on: the feed switches inside the page but the bar's active tab stays Discover, and the switch check's message fails.
sky_scrolled() {
  grep -q "Ron Filipkowski" "$1" && {
    echo "FAIL: the Solid feed did not scroll past its first post (Ron Filipkowski is still visible)"; return 1; }
  grep -q "Molecular Jackhammer" "$1" || { echo "FAIL: the Solid feed did not scroll to a later post's body"; return 1; }
  return 0
}
$SOLID --page sky --cols 80 --rows 12 --mutate scroll --keys Tab,Tab,PageDown --settle 60 --offset \
  --dump "$OUT/solid-sky-mut-scroll.txt" > "$OUT/solid-sky-mut-scroll.log"
grep -q "offset 0 px" "$OUT/solid-sky-mut-scroll.log" || {
  echo "FAIL: the scroll mutation did not keep the feed at row 0"; exit 1; }
if sky_scrolled "$OUT/solid-sky-mut-scroll.txt"; then
  echo "FAIL: the scroll mutation was not caught by the scrolling check"; exit 1; fi
echo "solid, terminal: mutation (the page's offset dropped before Clay): caught — the feed stays at row 0, and the FAIL above is the check's message"
sky_switched() {
  grep -q "Science — loading…" "$1" || {
    echo "FAIL: ArrowRight on the tablist did not switch the feed (the frame still says Discover's)"; return 1; }
  return 0
}
# the frame the key lands on is the page's switched tree: the bar's active tab moved and Science's first page is being
# asked. (The answer lands a frame later, so the frame is the loading state's, not the rows'.)
rm -f "$OUT"/solid-sky-switch.*
$SOLID --page sky --cols 80 --rows 20 --keys Tab,ArrowRight --frames-out "$OUT/solid-sky-switch"
sky_switched "$OUT/solid-sky-switch.2.txt" || exit 1
identical "ArrowRight's own frame is the switched tree: the tab moved and Science's first page is being asked"
rm -f "$OUT"/solid-sky-mut-tab.*
$SOLID --page sky --cols 80 --rows 20 --mutate tab --keys Tab,ArrowRight --frames-out "$OUT/solid-sky-mut-tab"
if sky_switched "$OUT/solid-sky-mut-tab.2.txt"; then
  echo "FAIL: the tab-switch mutation was not caught by the switch check"; exit 1; fi
echo "solid, terminal: mutation (no flush after the tab key): caught — the frame still says Discover's, and the FAIL above is the switch check's message"

# the cost: the feed's frame over 1600 cells and 34 commands, and the same cells as ANSI
skybench=$($SOLID --page sky --cols 80 --rows 20 --bench 50)
echo "$skybench"
case "$skybench" in
  *"ms a frame"*"1600 cells"*) ;;
  *) echo "FAIL: the Sky --bench printed no frame time or cell count"; exit 1 ;;
esac
echo "solid, terminal: the Sky feed's 8 comparisons above; the C feed is the oracle of behaviour, not of cells"

# ---- the feed's data: the app's recordings, its pages, and the three states ------------------------------------------
# `terminal/data.ts` is the terminal's AppView: apps/csssky's own calls answered from its recorded fixtures —
# `homeScreen` (Discover's two pages, Science's one; News has no recording, so it is the app's empty feed) and
# `threadScreen` (one thread, shown for whichever post opened it). `Sky.tsx` asks for them as it asks the AppView
# (`pages`, and the thread's `load`), and draws the answers as its own cards: page 1 when the feed opens, the next when
# the scroll reaches the feed's end (the app's sentinel at the list's end), appended under the reader, never a jump. The
# loading, end and error states are the page's **status line**: a row inside the clip would be out of view exactly at the
# end, because the page's content end is the window's and not the declared rows'.
#
# (a) the first page's rows are the recording's: the `feed_rows` print above (28 of its 30 posts, the app's own
#     moderation rule dropping two), and the status line's count is that number.
# (b) the end asks for the second page: 28 posts to 51, and page 2's rows are drawn (the stored frames).
# (c) a third page (no recording) is the feed's end: the page's words, and its frame stored.
# (d) `--offline` is the error state: the page's words, and no card.
# (e) a page-2 row's Enter opens the recorded thread: the same frame as the thread's own, byte for byte.
# (f) `cmp` of the two stored frames, before and after the second page, and the C feed's count above unchanged in kind.
#
# the page's own state lands a frame after the answer (Solid writes it in the host's flush), so the keys leave a frame
# between the ask and the End that reads the new content: `-` is that frame
feed_paged() {
  grep -q "Discover — 51 posts" "$1" || {
    echo "FAIL: the feed's end did not ask for the second page (want 51 posts: 28 + home-discover-2's 23)"; return 1; }
  return 0
}
$SOLID --page sky --cols 80 --rows 20 --keys Tab,Tab,End --settle 60 --dump "$OUT/solid-feed-page2.txt"
feed_paged "$OUT/solid-feed-page2.txt" || exit 1
cmp "$OUT/solid-feed-page2.txt" terminal/expected-solid-sky-page2.txt || {
  echo "FAIL: the frame after the second page's request is not terminal/expected-solid-sky-page2.txt"; exit 1; }
identical "the feed's end asks the second page: 28 posts to 51 (page 2's 23 appended); the reader stays at page 1's end"
$SOLID --page sky --cols 80 --rows 20 --keys Tab,Tab,End,-,-,-,End --settle 60 --dump "$OUT/solid-feed-end.txt"
grep -q "Discover — 51 posts — that's all for now" "$OUT/solid-feed-end.txt" || {
  echo "FAIL: the empty third page did not draw the page's end state"; exit 1; }
grep -q "Marcos Nogueira" "$OUT/solid-feed-end.txt" || {
  echo "FAIL: the end frame does not show page 2's rows (home-discover-2's last card)"; exit 1; }
cmp "$OUT/solid-feed-end.txt" terminal/expected-solid-sky-end.txt || {
  echo "FAIL: the feed's end frame is not terminal/expected-solid-sky-end.txt"; exit 1; }
identical "the empty third page is the page's end, 'Discover — 51 posts — that's all for now', page 2's rows drawn under it"
# the loading state, and its frame really appears: with no warm frames the first drawn frame is the one the ask is made
# on, and the answer is the next (the page starts empty, and says so rather than drawing the empty feed's words)
$SOLID --page sky --cols 80 --rows 20 --warm 0 --keys - --dump "$OUT/solid-feed-loading.txt"
grep -q "Discover — loading…" "$OUT/solid-feed-loading.txt" || {
  echo "FAIL: the feed's first frame is not its loading state"; exit 1; }
grep -q "Nothing here yet" "$OUT/solid-feed-loading.txt" && {
  echo "FAIL: the loading state drew the empty feed's words"; exit 1; }
identical "and the loading state is a frame the run draws: 'Discover — loading…', before the first page's answer"
# the knob that fails: `--offline` makes both calls fail, so the feed is the page's error state and a notification's row
# opens the thread's (the page's own words, no host text)
$SOLID --page sky --cols 80 --rows 20 --offline --dump "$OUT/solid-feed-offline.txt"
grep -q "Discover — could not load the feed" "$OUT/solid-feed-offline.txt" || {
  echo "FAIL: --offline did not draw the feed's error state"; exit 1; }
grep -q "Ron Filipkowski" "$OUT/solid-feed-offline.txt" && {
  echo "FAIL: --offline still drew a card (the feed is not empty)"; exit 1; }
identical "--offline is the error state: 'Discover — could not load the feed', and no card"
# ... and the same knob is the thread's: a notification's row opens its post through the page's own `load`, which fails
# too (the feed has no card to open offline, so the row is the way in)
$SOLID --page notify --cols 80 --rows 26 --offline --keys Enter --settle 3 --dump "$OUT/solid-feed-offline-thread.txt"
grep -q "The thread could not be loaded" "$OUT/solid-feed-offline-thread.txt" || {
  echo "FAIL: --offline left the thread's error state unpainted"; exit 1; }
identical "and the same knob is the thread's: 'The thread could not be loaded' over the list"
# (e) a row of the second page opens the recorded thread — the same frame the thread's own block stores, byte for byte,
# the recorded first reply in it (Mina Kimes, 226 likes; the parent above the post is another card)
$SOLID --page sky --cols 80 --rows 26 --keys Tab,Tab,End,-,-,-,End,-,-,Enter --settle 3 \
  --dump "$OUT/solid-feed-thread.txt"
cmp "$OUT/solid-feed-thread.txt" terminal/expected-solid-thread.txt || {
  echo "FAIL: a page-2 row's thread is not the recorded thread's frame (expected-solid-thread.txt)"; exit 1; }
grep -q "226 likes" "$OUT/solid-feed-thread.txt" || {
  echo "FAIL: the thread from a page-2 row did not draw the recording's first reply"; exit 1; }
identical "Enter on a page-2 row opens the recording's thread: expected-solid-thread.txt byte for byte, its first reply in it"
# the feed's two mutations. `--mutate end`: the page never asks past its first page, and the paging check's message is
# the FAIL. `--mutate cursor`: the source answers page 1 for page 2, and the page's dedupe (a card is its at-uri) adds
# nothing and calls it the end: 28 posts and "that's all for now", not 56 cards of page 1 twice
$SOLID --page sky --cols 80 --rows 20 --mutate end --keys Tab,Tab,End,-,-,-,End --settle 60 \
  --dump "$OUT/solid-feed-mut-end.txt"
if feed_paged "$OUT/solid-feed-mut-end.txt"; then
  echo "FAIL: the end mutation was not caught by the paging check"; exit 1; fi
grep -q "Discover — 28 posts" "$OUT/solid-feed-mut-end.txt" || {
  echo "FAIL: the end mutation did not stay at page 1"; exit 1; }
echo "solid, terminal: mutation (the page never asks past its first page): caught — the feed stays at 28 posts, and the FAIL above is the paging check's message"
feed_deduped() {
  grep -q "Discover — 28 posts — that's all for now" "$1" || {
    echo "FAIL: the repeated page was not deduped to the feed's end (want 28 posts and the end)"; return 1; }
  grep -q "Discover — 51 posts" "$1" && { echo "FAIL: the repeated page was added twice"; return 1; }
  return 0
}
$SOLID --page sky --cols 80 --rows 20 --mutate cursor --keys Tab,Tab,End,-,-,-,End --settle 60 \
  --dump "$OUT/solid-feed-mut-cursor.txt"
feed_deduped "$OUT/solid-feed-mut-cursor.txt" || {
  echo "FAIL: the cursor mutation was not deduped as the page's end"; exit 1; }
echo "solid, terminal: mutation (the source answers page 1 for page 2): caught — 28 posts, the repeats deduped to nothing,"
echo "solid, terminal: and the page says 'that's all for now' instead of asking the same page every frame"
# the cost with the full second page: the end frame over 1600 cells, and the same cells as ANSI
feedbench=$($SOLID --page sky --cols 80 --rows 20 --keys Tab,Tab,End,-,-,-,End --settle 60 --bench 50)
echo "$feedbench"
case "$feedbench" in
  *"ms a frame"*"1600 cells"*) ;;
  *) echo "FAIL: the feed's --bench with the second page printed no frame time or cell count"; exit 1 ;;
esac
# the payload: the recordings are module data (`with { type: "json" }`), inlined into the host's module graph — the four
# files, and nothing for the Sensors host, which imports `data.ts` only when it starts the Sky page
bytes=$(wc -c ../apps/csssky/test/fixtures/home-discover-1.json ../apps/csssky/test/fixtures/home-discover-2.json \
  ../apps/csssky/test/fixtures/home-science-1.json ../apps/csssky/test/fixtures/thread.json | tail -1 | awk '{ print $1 }')
echo "solid, terminal: the feed's recordings are $bytes bytes of JSON in the host's build (53,113 + 54,624 + 93,964 + 23,059),"
echo "solid, terminal: imported by terminal/data.ts as JSON modules; the Sensors host imports none of them"
echo "solid, terminal: the feed's data: 6 comparisons above (the pages, the end, the loading and error states, the thread)"

# ---- the thread, the page's second screen -------------------------------------------------------------------------
# `Sky.tsx` mounts the thread as a root float over the feed when a card is opened: its own onClick (a click on the card,
# or Enter on the feed, which the host delivers as the first card's onClick — the C feed's Enter opens the focused post's
# thread). Its data is the app's **recorded** answer, apps/csssky/test/fixtures/thread.json through the page's own
# `screenOf` (the fixture solid/thread.test.ts hands it): the host's `load` is a promise it settles with that screen one
# frame after the screen mounts, so the loading row is a frame the run draws and the app's rows are the one after it.
# The C thread (terminal/thread.c) is the behaviour's oracle, not the cells': its cards all carry a hand-cut border, its
# name and meta share a row, its body is clipped to one row, its counts are the glyphs `↩ ⟲ ♥` and its bar says
# "sky · Thread (esc: back)", where the page's bar stays the page's. The row/cell distance is counted, as the feed's is.
rm -f "$OUT"/solid-thread*
$SOLID --page sky --cols 80 --rows 26 --keys Tab,Tab,Enter --settle 3 --dump "$OUT/solid-thread.txt"
cmp "$OUT/solid-thread.txt" terminal/expected-solid-thread.txt || {
  echo "FAIL: the Solid thread at 80x26 is not terminal/expected-solid-thread.txt"; exit 1; }
identical "the thread's frame is terminal/expected-solid-thread.txt (80x26 cells, the page's own guard)"
grep -q "Mina Kimes" "$OUT/solid-thread.txt" || {
  echo "FAIL: the loader's answer did not land (the recorded thread's parent row is missing)"; exit 1; }
grep -q "Thanks for being with us here on Bluesky" "$OUT/solid-thread.txt" || {
  echo "FAIL: the recorded thread's posts are not all drawn"; exit 1; }
identical "the host's load promise lands the app's recorded thread: its parent, the post and the reply tree"
# Enter on the card: the loading row first, the rows a frame later (the screen mounts a frame after the ask, so the
# loading frame is the one after that)
$SOLID --page sky --cols 80 --rows 20 --keys Tab,Tab,Enter --settle 1 --dump "$OUT/solid-thread-loading.txt"
grep -q "Loading the thread…" "$OUT/solid-thread-loading.txt" || {
  echo "FAIL: Enter on the feed did not open the thread's loading state"; exit 1; }
identical "Enter on a card (the host's press of the page's own onClick) opens the thread in its loading state"
# the thread's clip on the page's own machine (a second instance of src/vscroll.ts): Tab from the Back reaches it, and
# ArrowDown is 40px. The keys need a frame with no input between the rows landing and the first scroll: the page measures
# its content from the last layout (`-` is that frame)
$SOLID --page sky --cols 80 --rows 26 --keys Tab,Tab,Enter,-,Tab,-,ArrowDown --settle 40 --offset \
  --dump "$OUT/solid-thread-scroll.txt" | tee "$OUT/solid-thread-scroll.log"
grep -q "thread offset -40 px (-2.50 rows)" "$OUT/solid-thread-scroll.log" || {
  echo "FAIL: ArrowDown on the thread's clip did not move it 40px"; exit 1; }
grep -q "Talked to @wired.com" "$OUT/solid-thread-scroll.txt" && {
  echo "FAIL: the thread did not scroll past its first card"; exit 1; }
identical "ArrowDown on the thread's clip scrolls it 40px (-2.5 rows), and the first card leaves"
# Escape is the page's back: the exit's 0.3s is drawn as the screen staying (its group's alpha and translate are a
# cell's to drop), so the check waits it out; then the feed is back, with the card the Enter selected
$SOLID --page sky --cols 80 --rows 26 --keys Tab,Tab,Enter,Escape --settle 30 --dump "$OUT/solid-thread-back.txt"
thread_back() {
  grep -q "Mina Kimes" "$1" && {
    echo "FAIL: Escape did not leave the thread (its rows are still drawn)"; return 1; }
  grep -q "Ron Filipkowski" "$1" || { echo "FAIL: Escape did not come back to the feed"; return 1; }
  return 0
}
thread_back "$OUT/solid-thread-back.txt" || exit 1
identical "Escape (the page's own back) leaves the thread, and the feed is back with its card selected"
# the counted comparison with the C thread (26 rows, 80 columns, as native/test.sh draws it)
base=$(sky_diff terminal/expected-thread.txt "$OUT/solid-thread.txt" 26)
echo "solid, terminal: the thread against terminal/expected-thread.txt (the C thread): $base"
case "$base" in
  "1957 cells, 0 of 26 rows the same, the worst row 1 (80 of 80);"*) ;;
  *) echo "FAIL: the thread's row/cell distance from the C thread changed (expected 1957 cells, row 1 the worst)"; exit 1 ;;
esac
echo "solid, terminal: the thread's worst row is the C card's top border against the page's head row (the C's bar is"
echo "solid, terminal: 'sky · Thread (esc: back)', the page's bar is the page's); the nearest rows are the body lines"
echo "solid, terminal: (row 2: 67, row 3: 79 — its words at a different inset and length) and the counts row (row 11: 71),"
echo "solid, terminal: where the words are the same and the C's are the glyphs ↩ ⟲ ♥. No row is identical."
# the two mutations of this screen. `--mutate open` drops a card's own onClick (a click and Enter leave the feed):
# the loading check's grep fails. `--mutate back` never hands the page an Escape: the thread stays, and the back check's
# "Escape did not leave the thread" is the message
$SOLID --page sky --cols 80 --rows 26 --mutate back --keys Tab,Tab,Enter,Escape --settle 30 \
  --dump "$OUT/solid-thread-mut-back.txt"
if thread_back "$OUT/solid-thread-mut-back.txt"; then
  echo "FAIL: the back mutation was not caught by the back check"; exit 1; fi
echo "solid, terminal: mutation (no Escape reaches the page): caught — the thread stays, and the FAIL above is the check's message"
$SOLID --page sky --cols 80 --rows 20 --mutate open --click 20,4 --settle 1 --dump "$OUT/solid-thread-mut-open.txt"
if thread_opened "$OUT/solid-thread-mut-open.txt"; then
  echo "FAIL: the open mutation was not caught by the loading check"; exit 1; fi
echo "solid, terminal: mutation (a card's own onClick dropped): caught — the feed's frame stays, and the FAIL above is the check's message"
# the cost: the thread's frame over 2080 cells (26 rows) and 66 commands, and the same cells as ANSI
threadbench=$($SOLID --page sky --cols 80 --rows 26 --keys Tab,Tab,Enter --settle 3 --bench 50)
echo "$threadbench"
case "$threadbench" in
  *"ms a frame"*"2080 cells"*) ;;
  *) echo "FAIL: the thread's --bench printed no frame time or cell count"; exit 1 ;;
esac
echo "solid, terminal: the thread's 5 comparisons above; the C thread is the oracle of behaviour, not of cells"

# ---- the profile, the page's third screen -------------------------------------------------------------------------
# `Profile.tsx` is not an entry of its own: `Sky.tsx` calls its `createProfile` and declares the screen in its own tree, so
# there is no `--page profile` here (the C `demo --page profile` is a stack entry point its own host has). It is the
# page's state: a click on a card's author row (the app's link to /profile/handle) opens it, with the app's recorded
# getProfile and three author feeds (apps/csssky's fixtures, read by app/profile.ts through the page's own postOf) —
# there is nothing for the host to hand it, unlike the thread's `load`. The C profile (terminal/profile.c) is the
# behaviour's oracle, not the cells': its banner is a two-row band, its tab is an accent pill, its cards carry the app's
# reason line ("Pinned", "Reposted by ...") and their bodies are clipped to one row.
rm -f "$OUT"/solid-profile*
$SOLID --page sky --cols 80 --rows 26 --click 20,2 --settle 5 --dump "$OUT/solid-profile.txt"
cmp "$OUT/solid-profile.txt" terminal/expected-solid-profile.txt || {
  echo "FAIL: the Solid profile at 80x26 is not terminal/expected-solid-profile.txt"; exit 1; }
identical "the profile's frame is terminal/expected-solid-profile.txt (80x26 cells, the page's own guard)"
grep -q "official Bluesky account" "$OUT/solid-profile.txt" || {
  echo "FAIL: the profile is not the recording's header"; exit 1; }
grep -q "35M followers · 15 following · 865 posts" "$OUT/solid-profile.txt" || {
  echo "FAIL: the profile's counts are not the recording's"; exit 1; }
profile_opened() {
  grep -q "Posts Replies Media" "$1" || {
    echo "FAIL: a click on a card's author row did not open the profile"; return 1; }
  return 0
}
profile_opened "$OUT/solid-profile.txt" || exit 1
identical "a click on a card's author row opens the profile: the recording's head, its bio, its counts and its tabs"
# the tabs are the page's headless tablist: Tab from the Back reaches it and ArrowRight switches Posts to Replies; the
# list starts at its top again (a fresh machine for the tab)
$SOLID --page sky --cols 80 --rows 26 --click 20,2 --keys Tab,ArrowRight --settle 5 --dump "$OUT/solid-profile-replies.txt"
grep -q "But we think that researchers should be the priority" "$OUT/solid-profile-replies.txt" || {
  echo "FAIL: Tab,ArrowRight on the profile's tablist did not switch Posts to Replies"; exit 1; }
grep -q "Bluesky is an open social network" "$OUT/solid-profile-replies.txt" && {
  echo "FAIL: the Replies tab still shows the Posts tab's pinned card"; exit 1; }
identical "Tab,ArrowRight on the profile's tablist switches Posts to Replies (and its list starts at the top)"
# the list scrolls on its own machine: Tab,Tab from the Back to the clip, ArrowDown 40px. The header and the tablist are
# the clip's siblings, so they stay put
$SOLID --page sky --cols 80 --rows 26 --click 20,2 --keys Tab,Tab,ArrowDown --settle 40 --offset \
  --dump "$OUT/solid-profile-scroll.txt" | tee "$OUT/solid-profile-scroll.log"
grep -q "profile offset -40 px (-2.50 rows)" "$OUT/solid-profile-scroll.log" || {
  echo "FAIL: ArrowDown on the profile's clip did not move it 40px"; exit 1; }
grep -q "@bsky.app · Oct 17, 2024" "$OUT/solid-profile-scroll.txt" && {
  echo "FAIL: the profile's list did not scroll past its first card"; exit 1; }
grep -q "35M followers · 15 following · 865 posts" "$OUT/solid-profile-scroll.txt" || {
  echo "FAIL: the profile's header scrolled with its list"; exit 1; }
identical "ArrowDown on the profile's clip scrolls the list 40px (-2.5 rows); its header and tabs stay put"
# Escape is the page's back (its fallback, whichever stop is focused): the profile leaves, the feed is back
$SOLID --page sky --cols 80 --rows 26 --click 20,2 --keys Escape --settle 30 --dump "$OUT/solid-profile-back.txt"
profile_back() {
  grep -q "Posts Replies Media" "$1" && {
    echo "FAIL: Escape did not leave the profile (its tablist is still drawn)"; return 1; }
  grep -q "Ron Filipkowski" "$1" || { echo "FAIL: Escape did not come back to the feed"; return 1; }
  return 0
}
profile_back "$OUT/solid-profile-back.txt" || exit 1
identical "Escape leaves the profile, and the feed is back"
# the counted comparison with the C profile (26 rows, 80 columns)
base=$(sky_diff terminal/expected-profile.txt "$OUT/solid-profile.txt" 26)
echo "solid, terminal: the profile against terminal/expected-profile.txt (the C profile): $base"
case "$base" in
  "1837 cells, 0 of 26 rows the same, the worst row 2 (80 of 80);"*) ;;
  *) echo "FAIL: the profile's row/cell distance from the C profile changed (expected 1837 cells, row 2 the worst)"; exit 1 ;;
esac
echo "solid, terminal: the profile's worst row is the C profile's banner band (two rows of colour) against the page's"
echo "solid, terminal: head row and drawn disc; the nearest rows are the header's (row 5: 38, the bio's words; row 8: 35,"
echo "solid, terminal: the counts; row 11: 29, the tabs), where the words are the same and the C's are one row a line with"
echo "solid, terminal: its own tones. No row is identical."
# the profile's own mutation: a click that never opens it leaves the feed's frame, and the profile check's message fails
$SOLID --page sky --cols 80 --rows 26 --mutate open --click 20,2 --settle 5 --dump "$OUT/solid-profile-mut-open.txt"
if profile_opened "$OUT/solid-profile-mut-open.txt"; then
  echo "FAIL: the open mutation was not caught by the profile check"; exit 1; fi
echo "solid, terminal: mutation (the author row's own onClick dropped): caught — the feed's frame stays, and the FAIL above is the check's message"
# the cost: the profile's frame over 2080 cells and 69 commands, and the same cells as ANSI
profilebench=$($SOLID --page sky --cols 80 --rows 26 --click 20,2 --settle 5 --bench 50)
echo "$profilebench"
case "$profilebench" in
  *"ms a frame"*"2080 cells"*) ;;
  *) echo "FAIL: the profile's --bench printed no frame time or cell count"; exit 1 ;;
esac
echo "solid, terminal: the profile's 5 comparisons above; the C profile is the oracle of behaviour, not of cells"

# ---- the notifications, the page's fourth screen ------------------------------------------------------------------
# `Sky.tsx` mounts the screen (`app/Notify.tsx`) when the feed's `n` opens it, or at the page's start with `--page
# notify` (the C host's `--page notifications`): the same page's tree, so a row's post opens the thread through the
# page's own `load` — the host's recorded thread — and that thread's back returns to the list. The rows are
# `app/notify.ts`'s: the app's five verbs, and each actor, text and time out of apps/csssky's recordings (the app has no
# notifications fixture, which is why they are hand-carried). The C screen (terminal/notify.c) is the behaviour's
# oracle, not the cells': its card has a hand-cut border and a separator row, its bar names the screen where the page's
# bar stays the page's, and its footer is the key hints.
rm -f "$OUT"/solid-notify*
$SOLID --page notify --cols 80 --rows 26 --dump "$OUT/solid-notify.txt"
cmp "$OUT/solid-notify.txt" terminal/expected-solid-notify.txt || {
  echo "FAIL: the Solid notifications at 80x26 are not terminal/expected-solid-notify.txt"; exit 1; }
identical "the notifications' frame is terminal/expected-solid-notify.txt (80x26 cells, the page's own guard)"
for v in "liked your post" "reposted" "followed you" "mentioned you" "replied"; do
  grep -q "$v" "$OUT/solid-notify.txt" || { echo "FAIL: no notification row has the verb \"$v\""; exit 1; }
done
identical "the five rows are the app's five verbs, out of the recordings' actors and posts"
# the focus order: the row the screen opens on, then the rows in document order (Tab), and the third row's frame is the
# C's own focus frame's
$SOLID --page notify --cols 80 --rows 26 --keys Tab,Tab --dump "$OUT/solid-notify-focus.txt"
cmp "$OUT/solid-notify-focus.txt" terminal/expected-solid-notify-focus.txt || {
  echo "FAIL: the Solid notifications after Tab,Tab are not terminal/expected-solid-notify-focus.txt"; exit 1; }
identical "Tab walks the rows in document order: two Tabs ring the third row (Michael Warburton)"
# past the last row the manager releases the focus and the page presses Tab again: the first row, the frame it opens on
$SOLID --page notify --cols 80 --rows 26 --keys Tab,Tab,Tab,Tab,Tab --dump "$OUT/solid-notify-wrap.txt"
cmp "$OUT/solid-notify-wrap.txt" "$OUT/solid-notify.txt" || {
  echo "FAIL: Tab past the last row did not wrap to the first (the frame is not the one it opens on)"; exit 1; }
identical "Tab past the last row wraps to the first: the frame is the one the screen opens on"
# Enter on a row is the page's own openThread, with the host's recorded thread; Escape is the page's back to the list
$SOLID --page notify --cols 80 --rows 26 --keys Enter --settle 3 --dump "$OUT/solid-notify-thread.txt"
notify_thread() {
  grep -q "Mina Kimes" "$1" && grep -q "Talked to @wired.com" "$1" || {
    echo "FAIL: Enter on a notification did not open its post's thread"; return 1; }
  grep -q "Back" "$1" || { echo "FAIL: the thread over the notifications has no back control"; return 1; }
  return 0
}
notify_thread "$OUT/solid-notify-thread.txt" || exit 1
identical "Enter on a row opens its post's thread in the same page (the recorded thread, the thread's back control)"
$SOLID --page notify --cols 80 --rows 26 --keys Enter,Escape --settle 40 --dump "$OUT/solid-notify-back.txt"
cmp "$OUT/solid-notify-back.txt" "$OUT/solid-notify.txt" || {
  echo "FAIL: Escape from a notification's thread did not come back to the list's frame"; exit 1; }
identical "Escape from that thread returns to the notifications: the same rows and the same ring"
$SOLID --page notify --cols 80 --rows 26 --keys End,Enter --settle 3 --dump "$OUT/solid-notify-follow.txt"
grep -q "Talked to @wired.com" "$OUT/solid-notify-follow.txt" && {
  echo "FAIL: Enter on the follow opened a thread (its notification has no post)"; exit 1; }
grep -q "Mina Kimes followed you" "$OUT/solid-notify-follow.txt" || {
  echo "FAIL: End did not reach the follow's row"; exit 1; }
identical "Enter on the follow opens nothing (no post, no thread), and the list stays"
# the counted comparison with the C notifications (26 rows, 80 columns)
base=$(sky_diff terminal/expected-notify.txt "$OUT/solid-notify.txt" 26)
echo "solid, terminal: the notifications against terminal/expected-notify.txt (the C screen): $base"
case "$base" in
  "1564 cells, 0 of 26 rows the same, the worst row 5 (80 of 80);"*) ;;
  *) echo "FAIL: the notifications' row/cell distance from the C screen changed (expected 1564 cells, row 5 the worst)"; exit 1 ;;
esac
focusd=$(sky_diff terminal/expected-notify-focus.txt "$OUT/solid-notify-focus.txt" 26)
echo "solid, terminal: after Tab,Tab against terminal/expected-notify-focus.txt: $focusd"
case "$focusd" in
  "1910 cells, 0 of 26 rows the same, the worst row 2 (80 of 80);"*) ;;
  *) echo "FAIL: the focused frame's row/cell distance from the C's changed (expected 1910 cells, row 2 the worst)"; exit 1 ;;
esac
echo "solid, terminal: the notifications' nearest rows are the header's (row 2: 5 of 80 — the same word, the page's Back"
echo "solid, terminal: control one cell in) and the first card's snippet (row 4: 9, the same words at a one-cell inset); the"
echo "solid, terminal: worst rows are the C's card borders and separator rows, which the page's cards at rest have none of,"
echo "solid, terminal: and its footer row, which the page does not draw. No row is identical."
# the two mutations this screen has to catch. `--mutate rows` never makes the rows Tab stops (the page's own break):
# Tab leaves the list, and the focus check's frame is not the third row's. `--mutate verbs` draws one wrong verb on
# every row: the stored dump is not the frame the screen makes.
$SOLID --page notify --cols 80 --rows 26 --mutate rows --keys Tab,Tab --dump "$OUT/solid-notify-mut-rows.txt"
if cmp -s "$OUT/solid-notify-mut-rows.txt" terminal/expected-solid-notify-focus.txt; then
  echo "FAIL: the rows mutation was not caught by the Tab check"; exit 1; fi
echo "solid, terminal: mutation (the rows never registered as Tab stops): caught — Tab,Tab is not the third row's frame,"
echo "solid, terminal: so the Tab check's comparison with expected-solid-notify-focus.txt fails"
$SOLID --page notify --cols 80 --rows 26 --mutate verbs --dump "$OUT/solid-notify-mut-verbs.txt"
if cmp -s "$OUT/solid-notify-mut-verbs.txt" terminal/expected-solid-notify.txt; then
  echo "FAIL: the verbs mutation was not caught by the stored dump"; exit 1; fi
echo "solid, terminal: mutation (one wrong verb on every row): caught — the dump is not expected-solid-notify.txt, so"
echo "solid, terminal: the stored-frame check's comparison fails"
# the cost: the notifications' frame over 2080 cells and 64 commands, and the same cells as ANSI
notifybench=$($SOLID --page notify --cols 80 --rows 26 --bench 50)
echo "$notifybench"
case "$notifybench" in
  *"ms a frame"*"2080 cells"*) ;;
  *) echo "FAIL: the notifications' --bench printed no frame time or cell count"; exit 1 ;;
esac
echo "solid, terminal: the notifications' 7 comparisons above; the C screen is the oracle of behaviour, not of cells"
echo "solid, terminal: all four of the Sky page's screens run as the page's own now (the feed, the thread, the profile, the"
echo "solid, terminal: notifications): $n comparisons, all identical"
# ---- the system theme: the terminal's own colours -----------------------------------------------------------------
# `--system-theme` asks the terminal (/dev/tty, terminal/tb2.c's term_tb2_ask) with @cssints/tui/system's QUERY and parses
# the answer with its `scan` — the tui app's parser, not a second one — then solves the Sky page's nine tokens with
# `createSystemTheme` (terminal/theme.ts): a surface at the background, its step up, the ink at 7:1, the accent from the
# terminal's blue. A pty that answers is a script here (terminal/pty-answer.py): the reply is OSC 11 (a light warm
# background), OSC 10 (a near-black foreground) and two OS 4 entries, the blue and the grey. What the dump proves is the
# page's own colour table: `# colours: index rgb glyphs fills`, so a line is a colour and its cell counts — the same page
# (289 fills of the page, 11 glyphs of the accent, 1309 of the panel) painted with the terminal's colours.
SYSTEM="$OUT/solid-system"
rm -f "$SYSTEM".*
printf '\033]11;rgb:f0f0/e0e0/d0d0\033\\\033]10;rgb:1010/1010/1010\033\\\033]4;4;rgb:0000/6060/d0d0\033\\\033]4;8;rgb:8080/8080/8080\033\\' \
  > "$OUT/system-replies.bin"
if command -v python3 >/dev/null 2>&1; then
  python3 terminal/pty-answer.py "$OUT/system-replies.bin" 30 -- \
    bun terminal/solid.ts --page sky --cols 80 --rows 20 --system-theme --dump "$SYSTEM.txt" > "$SYSTEM.log" 2>&1
  grep -q "terminal: #101010 on #f0e0d0 (light), 2 of the 16 palette entries" "$SYSTEM.log" || {
    echo "FAIL: the terminal's answer was not solved (want '#101010 on #f0e0d0 (light), 2 of the 16 palette entries')"; exit 1; }
  identical "the pty answered OSC 11/10/4, and scan + createSystemTheme made it #101010 on #f0e0d0, light"
  # the five colours of the page, with the cells they cover: the page fill is the answer's background, the accent glyphs
  # the answer's OSC 4;4 blue, the ink the answer's OSC 10, and the panel and the muted grey the solver's own steps
  # (the panel 1.1:1 from the page, the grey 4.5:1 -- its 0x808080 report is not enough on this light page)
  for line in "2 240,224,208 0 289" "3 0,96,208 11 0" "4 84,84,84 193 2" "5 229,214,198 0 1309" "6 16,16,16 436 0"; do
    grep -qx "$line" "$SYSTEM.txt" || {
      echo "FAIL: the system-themed frame has no '$line' in its colour table"; exit 1; }
  done
  identical "its cells are the palette: page 240,224,208 (OSC 11) under 289 fills, accent 0,96,208 (OSC 4;4) 11 glyphs"
  identical "and the solver's steps: panel 229,214,198, muted 84,84,84 (OSC 4;8 at 4.5:1), ink 16,16,16 (OSC 10)"
  # the terminal's answer changes the theme, not the page: the same counts as the stored dark frame
  defaults=$(sed -n 's/^\([2-6]\) [0-9,]* \([0-9]* [0-9]*\)$/\2/p' terminal/expected-solid-sky.txt | tr '\n' '|')
  solved=$(sed -n 's/^\([2-6]\) [0-9,]* \([0-9]* [0-9]*\)$/\2/p' "$SYSTEM.txt" | tr '\n' '|')
  [ "$solved" = "$defaults" ] || {
    echo "FAIL: the system theme moved cells ($solved) from the page's own ($defaults)"; exit 1; }
  identical "the glyph and fill counts are expected-solid-sky.txt's (289/11/0/1309 and 436): the page, repainted"
  # the live path: the ask comes before termbox2's alternate screen, and the screen it draws is the terminal's palette
  COLORTERM=truecolor PYTHONUNBUFFERED=1 python3 terminal/pty-answer.py "$OUT/system-replies.bin" 30 -- \
    bun terminal/solid.ts --page sky --system-theme --frames 2 > "$SYSTEM-live.log" 2>&1
  grep -q "terminal: 2 frames, 80x24" "$SYSTEM-live.log" || {
    echo "FAIL: the live system-themed screen drew no frame"; exit 1; }
  grep -qF "48;2;240;224;208" "$SYSTEM-live.log" || {
    echo "FAIL: the live screen has no fill of the answer's background (48;2;240;224;208)"; exit 1; }
  grep -qF "38;2;0;96;208" "$SYSTEM-live.log" || {
    echo "FAIL: the live screen has no glyph of the answer's blue (38;2;0;96;208)"; exit 1; }
  identical "the live screen (80x24, truecolour) is the palette: a fill of 240,224,208 and a glyph of 0,96,208"
  # a terminal that answers nothing: the 120 ms timeout, the fallback and its message, and the stored dark frame
  python3 terminal/pty-answer.py - 30 -- \
    bun terminal/solid.ts --page sky --cols 80 --rows 20 --system-theme --dump "$SYSTEM-none.txt" > "$SYSTEM-none.log" 2>&1
  grep -q "terminal: no colours from the terminal in .* ms (0 bytes); the dark theme" "$SYSTEM-none.log" || {
    echo "FAIL: a silent pty did not print the fallback's message"; exit 1; }
  cmp "$SYSTEM-none.txt" terminal/expected-solid-sky.txt || {
    echo "FAIL: the silent pty's frame is not the dark one (expected-solid-sky.txt)"; exit 1; }
  identical "a pty that never answers: 'no colours from the terminal in 120.x ms (0 bytes); the dark theme', the dark frame"
  # the cost: the ask's own wall time and the frame's, on this machine (the timeout is only paid by a silent terminal)
  sysbench=$(python3 terminal/pty-answer.py "$OUT/system-replies.bin" 40 -- \
    bun terminal/solid.ts --page sky --cols 80 --rows 20 --system-theme --bench 50 2>/dev/null | tr -d '\r' |
    grep "ms a frame" | head -1)
  echo "solid, terminal: the system theme's frame: $sysbench"
  case "$sysbench" in
    *"ms a frame"*) ;;
    *) echo "FAIL: the system theme's --bench printed no frame time"; exit 1 ;;
  esac
  # the two mutations. `--mutate channel` reads the answer's foreground as its background: the page is the near-black
  # where the answer was the light warm colour, so the colour-table check above fails. `--mutate wait` asks with no
  # timeout: a pty that never answers leaves the host waiting, and the helper kills it after 2 s with its message
  python3 terminal/pty-answer.py "$OUT/system-replies.bin" 30 -- \
    bun terminal/solid.ts --page sky --cols 80 --rows 20 --system-theme --mutate channel --dump "$SYSTEM-mut.txt" \
    > "$SYSTEM-mut.log" 2>&1
  if grep -qx "2 240,224,208 0 289" "$SYSTEM-mut.txt"; then
    echo "FAIL: the wrong-channel mutation was not caught (the page is still the answer's light background)"; exit 1; fi
  grep -qx "2 16,16,16 0 289" "$SYSTEM-mut.txt" || {
    echo "FAIL: the wrong-channel mutation did not paint the page with the answer's foreground"; exit 1; }
  echo "solid, terminal: mutation (the answer's foreground read as its background): caught — the page fill is 16,16,16, and the FAIL above is the colour check's message"
  python3 terminal/pty-answer.py - 2 -- \
    bun terminal/solid.ts --page sky --cols 80 --rows 20 --system-theme --mutate wait --dump "$SYSTEM-hang.txt" \
    > "$SYSTEM-hang.log" 2>&1 || true
  grep -q "pty-answer: the host was still running after 2s; killed" "$SYSTEM-hang.log" || {
    echo "FAIL: the no-timeout mutation did not hang (the host returned)"; exit 1; }
  [ ! -s "$SYSTEM-hang.txt" ] || { echo "FAIL: the hung host wrote a frame"; exit 1; }
  echo "solid, terminal: mutation (the ask with no timeout): caught — 'the host was still running after 2s; killed', no frame"
else
  echo "solid, terminal: no python3, the pty's answering-terminal checks skipped"
fi
# ... and a dumb terminal costs nothing: the flag is not even asked, and the frame is the dark one
TERM=dumb $SOLID --page sky --cols 80 --rows 20 --system-theme --dump "$SYSTEM-dumb.txt" 2> "$SYSTEM-dumb.log"
grep -q "terminal: TERM=dumb, no colours asked; the dark theme" "$SYSTEM-dumb.log" || {
  echo "FAIL: TERM=dumb did not take the fallback without asking"; exit 1; }
cmp "$SYSTEM-dumb.txt" terminal/expected-solid-sky.txt || {
  echo "FAIL: TERM=dumb's frame is not the dark one (expected-solid-sky.txt)"; exit 1; }
identical "TERM=dumb: no query, 'no colours asked; the dark theme', and the dark frame"
echo "solid, terminal: the system theme's comparisons above; the terminal's colours, the solver's steps and the fallback"
