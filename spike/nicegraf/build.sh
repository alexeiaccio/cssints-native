#!/bin/sh
# Fetches and builds nicegraf's Metal backend, then the spike's quad binary.
#
#   sh native/spike/nicegraf/build.sh            -> out/quad, prints the seconds each step took
#
# nicegraf is a shallow clone into this folder (not a submodule: it is a spike, and `git status` in the repo above
# should not grow a gitlink). Nothing is vendored: run.sh fetches it, at the commit named in run.sh, and applies one
# patch — the tree at that commit does not compile with Xcode 16's clang, see the sed below.
set -e
cd "$(dirname "$0")"
NGF_COMMIT=c7b273998e522ac852d6257a4d01383ec7905c7e
BREW="$(brew --prefix)"

if [ ! -d nicegraf/.git ]; then
  git clone --depth 1 https://github.com/nicebyte/nicegraf nicegraf
fi
git -C nicegraf fetch --depth 1 origin "$NGF_COMMIT" 2>/dev/null || true
git -C nicegraf checkout -q "$NGF_COMMIT"

# The fix: source/ngf-mtl/impl.cpp uses class-template argument deduction on an alias template
# (`ngfi::fixed_array {ptr, len}`), which clang 16 rejects ("argument deduction only allowed for class templates");
# spelling the element type out is the whole change.
if ! grep -q "ngfi::fixed_array<char> {(const char\*)info.content" nicegraf/source/ngf-mtl/impl.cpp; then
  sed -i '' 's/ngfi::fixed_array {(const char\*)info.content/ngfi::fixed_array<char> {(const char*)info.content/; s/ngfi::fixed_array {info.entry_point_name/ngfi::fixed_array<char> {info.entry_point_name/' \
    nicegraf/source/ngf-mtl/impl.cpp
fi

t0=$(date +%s)
if [ ! -f build-ngf/libnicegraf-mtl.a ]; then
  cmake -GNinja -S nicegraf -B build-ngf -DCMAKE_BUILD_TYPE=Release \
    -DNGF_BUILD_SAMPLES=no -DNGF_BUILD_TESTS=no > build-config.log 2>&1
  cmake --build build-ngf >> build-config.log 2>&1
fi
t_lib=$(($(date +%s) - t0))

mkdir -p out
t0=$(date +%s)
c++ -std=c++20 -O2 -I nicegraf/include \
  quad.cpp build-ngf/libnicegraf-mtl.a build-ngf/libnicegraf-util.a build-ngf/libnicegraf-internal.a \
  -framework Metal -framework QuartzCore -framework CoreGraphics -framework Cocoa -lz -o out/quad
t_quad=$(($(date +%s) - t0))

echo "build: nicegraf ${t_lib}s (cmake configure + build), quad ${t_quad}s, binary $(wc -c < out/quad | tr -d ' ') bytes"
echo "build: $(wc -l < nicegraf/source/ngf-mtl/impl.cpp) lines of Metal backend, $(wc -l < quad.cpp) lines of quad pipeline"
