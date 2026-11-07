#!/bin/sh
# The nicegraf spike, end to end: fetch and build nicegraf's Metal backend, draw the Sensors frame's six quads
# through one pipeline / one vertex buffer / one draw call into a 360x360 offscreen target, and print the table.
# Exits 1 if any number in it is missing.
#
#   sh native/spike/nicegraf/run.sh            ~15 s on the first run (the clone and cmake), ~5 s after
#
# Needs Xcode's command line tools (Metal), cmake, ninja and brew thorvg + SDL3 (for the CPU side of the comparison).
# Not in native/test.sh: it fetches a library from the network and needs a GPU, and the suite is gates, not
# measurements (the Hershey spike is out for the same reason, its bench being ~95 s).
set -e
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
TMP="${TMPDIR:-/tmp}/cssints-nicegraf"
mkdir -p out "$TMP"
BREW="$(brew --prefix)"

echo "nicegraf spike: $(uname -sm), $(sysctl -n hw.ncpu) cores, load $(uptime | sed 's/.*load averages*: //')"
echo "                $(date), $(sysctl -n machdep.cpu.brand_string)"
echo

# 1. the library and the quad binary, from a clean tree (the build time is a number in the table)
rm -rf build-ngf out/quad
sh build.sh | tee "$TMP/build.txt"

# 2. the CPU side: the same quads through ThorVG's software canvas, and the page's real frame (text, borders)
cc -std=c11 -O2 -Wall -I "$BREW/include" -I "$BREW/include/thorvg-1" cpu.c \
  -L "$BREW/lib" -lthorvg-1 -lm -o out/cpu
# The machine is shared and loaded, so every number is the smallest of three back-to-back runs (the rule
# native/README.md's benches use on a loaded box).
for i in 1 2 3; do
  ./out/cpu --bench 300 > "$TMP/cpu.$i.txt"
  ./out/cpu --bench 300 --grid 496 > "$TMP/cpu500.$i.txt"
  ./out/quad --bench 300 --png out/sensors-quads.png --raw "$TMP/sensors.rgba" > "$TMP/quad.$i.txt" 2>&1
  ./out/quad --bench 300 --grid 496 > "$TMP/quad500.$i.txt" 2>&1
done
if [ ! -x "$ROOT/build/sensors/app" ]; then sh "$ROOT/desktop/build.sh" "$ROOT/examples/sensors" >/dev/null; fi
"$ROOT/build/sensors/app" --png "$TMP/frame.png" --raster thorvg --bench 300 > "$TMP/thorvg.txt"

# 3. the table, from those files; a missing number fails the run
get() { grep -o "$2 [0-9.]* ms" "$1" | head -1 | awk '{print $2}'; }
min3() { printf '%s\n%s\n%s\n' "$1" "$2" "$3" | grep . | sort -n | head -1; }
pick() { min3 "$(get "$TMP/$1.1.txt" "$2")" "$(get "$TMP/$1.2.txt" "$2")" "$(get "$TMP/$1.3.txt" "$2")"; }
build=$(grep -o 'binary [0-9]* bytes' "$TMP/build.txt" | sed 's/binary //; s/ bytes//')
ngf=$(grep -o 'nicegraf [0-9]*s' "$TMP/build.txt" | head -1 | sed 's/nicegraf //; s/s$//')
lines=$(grep -o '[0-9]* lines of quad pipeline' "$TMP/build.txt" | sed 's/ lines.*//')
a=$(pick quad submit)
b=$(pick quad gpu)
bs=$(pick quad gpu_sync)
r=$(pick quad readback)
d=$(pick quad with_readback)
b5=$(pick quad500 gpu)
d5=$(pick quad500 with_readback)
c=$(pick cpu rects)
c5=$(pick cpu500 rects)
t=$(grep -o "thorvg: [0-9.]* ms" "$TMP/thorvg.txt" | awk "{print \$2}")

missing=
for v in a b bs r d b5 d5 c c5 t build ngf lines; do
  eval "val=\$$v"
  [ -n "$val" ] || missing="$missing $v"
done
if [ -n "$missing" ]; then
  echo "MISSING:$missing" >&2
  exit 1
fi

echo
printf 'the Sensors frame (360x360, six quads: fill, pill, four 1px border strips; no glyphs, no AA, no radii)\n'
printf '  %-56s %8s ms\n' 'nicegraf/Metal, record + submit (CPU)' "$a"
printf '  %-56s %8s ms\n' 'nicegraf/Metal, GPU throughput, no readback' "$b"
printf '  %-56s %8s ms\n' 'nicegraf/Metal, draw + wait, no readback' "$bs"
printf '  %-56s %8s ms\n' 'nicegraf/Metal, the readback alone (copy + wait + map)' "$r"
printf '  %-56s %8s ms\n' 'nicegraf/Metal, frame with readback' "$d"
printf '  %-56s %8s ms\n' 'ThorVG CPU, the same six quads' "$c"
printf '  %-56s %8s ms\n' 'ThorVG CPU, the real frame (10 commands, text, border)' "$t"
echo
printf 'a frame that is many shapes (502 quads, the same target)\n'
printf '  %-56s %8s ms\n' 'nicegraf/Metal, GPU throughput, no readback' "$b5"
printf '  %-56s %8s ms\n' 'nicegraf/Metal, frame with readback' "$d5"
printf '  %-56s %8s ms\n' 'ThorVG CPU, the same 502 quads' "$c5"
echo
printf 'setup\n'
printf '  %-56s %8s s\n' 'nicegraf, cmake configure + build (Metal only)' "$ngf"
printf '  %-56s %8s\n' 'the quad pipeline (quad.cpp: shaders, calls, bench, png)' "$lines lines"
printf '  %-56s %8s\n' 'the binary (all three nicegraf static libs inside)' "$build bytes"
printf '  %-56s %8s\n' 'nicegraf commit' c7b2739
printf '  %-56s %8s\n' 'its Metal backend + common' "$(cat nicegraf/source/ngf-mtl/*.cpp nicegraf/source/ngf-mtl/*.mm nicegraf/source/ngf-common/*.c* 2>/dev/null | wc -l | tr -d ' ') lines"
printf '  %-56s %8s\n' 'deps it needed on this Mac' 'metal-cpp 1 header, 0 submodules'
echo
echo "the frame: out/sensors-quads.png (and the same pixels raw in $TMP/sensors.rgba)"
