#!/bin/sh
# The handoff and QA figures on the terminal (terminal/solid.ts --page figure): the same layouts the desktop draws, cells
# for cells. The grid is each figure's own size (the layout's cells plus the figure's two cells of padding either side,
# and its rows plus one above and below): the terminal host re-cuts nothing, so a spec that grows and leaves these numbers
# stale is this script's grep, not a screenshot.
#
#   sh terminal/figure-handoff.sh      # from native/, or from anywhere (it cds)
set -e
cd "$(dirname "$0")/.."
FIG="${TMPDIR:-/tmp}/cssints-figure-handoff-terminal"
mkdir -p "$FIG"
SOLID="bun terminal/solid.ts"
n=0
identical() { n=$((n + 1)); echo "solid, terminal: $1 -> identical"; }

# the redline: the switch's row, its leaders (· and -) and every number the page's style gives
$SOLID --page figure --spec solid/specs/redline.json --cols 67 --rows 8 --dump "$FIG/redline.txt"
grep -q "The Wi-Fi switch's row" "$FIG/redline.txt" || { echo "FAIL: the redline drew no title"; exit 1; }
grep -q "44x24" "$FIG/redline.txt" || { echo "FAIL: the redline drew no track size"; exit 1; }
grep -q "204x16" "$FIG/redline.txt" || { echo "FAIL: the redline drew no label size"; exit 1; }
identical "the redline: the box's leaders and the page's own numbers (10, 44x24, 12, 204x16, 10)"

# the before/after: two panels on one row, and the numbers that changed under them
$SOLID --page figure --spec solid/specs/before-after.json --cols 71 --rows 11 --dump "$FIG/before-after.txt"
grep -q "off" "$FIG/before-after.txt" || { echo "FAIL: the before/after drew no off caption"; exit 1; }
grep -q "240,140,50" "$FIG/before-after.txt" || { echo "FAIL: the before/after drew no on colour"; exit 1; }
grep -q "60,64,78 -> 240,140,50" "$FIG/before-after.txt" || { echo "FAIL: the before/after drew no changed track"; exit 1; }
identical "the before/after: two panels and the frames' changed numbers (the track, the thumb)"

# the checklist: a row a comparison, the summary its rows count, and the key
$SOLID --page figure --spec solid/specs/qa-checklist.json --cols 91 --rows 18 --dump "$FIG/qa-checklist.txt"
grep -q "12 of 12 pass" "$FIG/qa-checklist.txt" || { echo "FAIL: the checklist drew no summary"; exit 1; }
grep -q "solid/frames/sky.png" "$FIG/qa-checklist.txt" || { echo "FAIL: the checklist drew no stored frame's name"; exit 1; }
grep -q "Escape leaves the profile, and the feed is back" "$FIG/qa-checklist.txt" || {
  echo "FAIL: the checklist drew no terminal comparison's name"; exit 1; }
identical "the checklist: the suite's names, the 12 of 12 pass summary and the key"
echo "solid, terminal: the handoff figures: $n comparisons, all identical"
