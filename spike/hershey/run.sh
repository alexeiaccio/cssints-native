#!/bin/sh
# The Hershey spike, end to end: the table's bytes, the three rasters a size (strokes, the same strokes at Roboto's
# advances, Roboto through ThorVG's text path), the CoreText oracle, the ink weight and SSIM against it, the A8 atlas and
# the ms table. Prints everything and exits 1 if a line of the table is missing.
#
#   sh native/spike/hershey/run.sh            ~100 s (the bench is 5 runs x 200/100/20 frames x 300 runs)
#
# Needs cc, brew thorvg + SDL3 + SDL3_image, node and swiftc (for the oracle; ~10 s, once). Not in native/test.sh: the
# bench is a minute and a half, and the suite is gates, not measurements.
set -e
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
FONT="$ROOT/vendor/fonts/Roboto-Regular.ttf"
TABLE="out/futural.bin"
CYRIL="out/cyrilc.bin"
TMP="${TMPDIR:-/tmp}/cssints-hershey"
mkdir -p out "$TMP"
BREW="$(brew --prefix)"

echo "hershey spike: $(uname -sm), $(sysctl -n hw.ncpu) cores, load $(uptime | sed 's/.*load averages*: //'), $(date)"
echo "               ThorVG $(pkg-config --modversion thorvg 2>/dev/null || echo '(brew thorvg-1)'), node $(node -v)"
echo

# 1. the data: .jhf -> the table whose bytes are the answer
node parse.mjs "$ROOT/vendor/hershey/futural.jhf" "$TABLE" | tee "$TMP/parse.txt"
node parse.mjs "$ROOT/vendor/hershey/cyrilc_1.jhf" "$CYRIL" | tee "$TMP/cyril.txt"

# 2. the program
cc -std=c11 -O2 -Wall -Wno-unused-function -Wno-missing-field-initializers \
  -I "$BREW/include" -I "$BREW/include/thorvg-1" draw.c \
  -L "$BREW/lib" -lthorvg-1 -lSDL3 -lSDL3_image -lm -o out/draw

# 3. the bytes, data for data
{
  printf 'bytes: hershey table %s (latin, all sizes), %s with the cyrillic set\n' \
    "$(wc -c < "$TABLE" | tr -d ' ')" "$(($(wc -c < "$TABLE") + $(wc -c < "$CYRIL")))"
  printf 'bytes: Roboto-Regular.ttf %s (every size, every glyph it has)\n' "$(wc -c < "$FONT" | tr -d ' ')"
} | tee "$TMP/bytes.txt"
./out/draw atlas "$FONT" | tee "$TMP/atlas.txt"

# 4. the pages, CoreText's raster of the same, and the metric
ORACLE="$ROOT/build/solid/text-oracle"
if [ ! -x "$ORACLE" ]; then
  mkdir -p "$ROOT/build/solid"
  swiftc -O "$ROOT/solid/text-oracle.swift" -o "$ORACLE"
fi
: > "$TMP/pages.txt"
for size in 14 40 96; do
  ./out/draw page "$size" out "$FONT" "$TABLE" | tee -a "$TMP/pages.txt"
  "$ORACLE" out/page-"$size".json
done
node compare.mjs out 14 40 96 | tee "$TMP/metric.txt"

# 5. the ms table: last, so a busy machine's noise is at the end and not hidden
./out/draw bench "$FONT" "$TABLE" | tee "$TMP/bench.txt"

# 6. every number accounted for
need() {
  grep -q "$2" "$1" || { echo "run.sh: missing $3 in $1" >&2; exit 1; }
}
count() {
  n=$(grep -c "$2" "$1" || true)
  [ "$n" = "$3" ] || { echo "run.sh: $1 has $n of \"$2\", wanted $3" >&2; exit 1; }
}
need "$TMP/parse.txt" "96 glyphs" "the latin glyph count"
need "$TMP/parse.txt" "bytes into" "the latin table's size"
need "$TMP/bytes.txt" "hershey table" "the data's bytes"
need "$TMP/atlas.txt" "atlas: " "the atlas total"
count "$TMP/atlas.txt" "^atlas [0-9]" 3
count "$TMP/pages.txt" "^page " 3
count "$TMP/metric.txt" "^  mean: strokes weight" 3
need "$TMP/metric.txt" "^metric: strokes weight" "the metric's total"
count "$TMP/bench.txt" "^bench [0-9]" 6
count "$TMP/bench.txt" "over the empty page" 3

echo
echo "run.sh: the table is above; every number was printed"
