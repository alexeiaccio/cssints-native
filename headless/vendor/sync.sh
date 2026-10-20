#!/bin/sh
# Copy the spec side of @eoa/headless's tests from effects-of-atmosphere (read-only there) at the commit in EOA_COMMIT.
# The files are read from git at that commit (cat-file, no checkout, no textconv), so the eoa working tree may be on
# another commit. To move the pin, write the new commit to EOA_COMMIT first, then run this.
# Usage: sh vendor/sync.sh [path to effects-of-atmosphere]
set -e
EOA="${1:-$HOME/github/effects-of-atmosphere}"
HERE="$(cd "$(dirname "$0")" && pwd)"
COMMIT="$(cat "$HERE/EOA_COMMIT")"
P="button switch checkbox disclosure radio tabs toolbar slider treeview dialog-modal menu-button menu-checkable menu-menubar"
git -C "$EOA" cat-file -e "$COMMIT^{commit}"

# copy <path under packages/> <destination>: the blob at the pinned commit, byte for byte
copy() {
  mkdir -p "$(dirname "$2")"
  git -C "$EOA" cat-file blob "$COMMIT:packages/$1" > "$2"
}
# the ported scenario files of one pattern
scenarios() {
  git -C "$EOA" ls-tree --name-only "$COMMIT" packages/specs/scenarios/apg/ \
    | grep "^packages/specs/scenarios/apg/$1\.[^/]*\.json$"
}

copy quint-machine/src/core.ts "$HERE/quint-machine/src/core.ts"
copy quint-machine/src/runtime.ts "$HERE/quint-machine/src/runtime.ts"
# the package index also re-exports scxml.ts, which the tests do not need
git -C "$EOA" cat-file blob "$COMMIT:packages/quint-machine/src/index.ts" | grep -v scxml > "$HERE/quint-machine/src/index.ts"
copy specs/src/scenario.ts "$HERE/specs/src/scenario.ts"
copy specs/scenarios/apg/README.md "$HERE/specs/scenarios/apg/README.md"
# imported by tabs, slider and toolbar (toolbar also by focusgroup); the specs use relative paths, so keep the layout
copy specs/shared/aria.qnt "$HERE/specs/shared/aria.qnt"
copy specs/shared/focusgroup.qnt "$HERE/specs/shared/focusgroup.qnt"
for p in $P; do
  copy "specs/src/apg/$p.bridge.ts" "$HERE/specs/src/apg/$p.bridge.ts"
  copy "specs/src/apg/$p.model.generated.json" "$HERE/specs/src/apg/$p.model.generated.json"
  copy "specs/specs/apg/$p.qnt" "$HERE/specs/specs/apg/$p.qnt"
  for file in $(scenarios "$p"); do
    copy "${file#packages/}" "$HERE/specs/scenarios/apg/$(basename "$file")"
  done
done
# the menubar's scenarios are named `menubar.*.json`, not `menu-menubar.*.json`
for file in $(scenarios menubar); do
  copy "${file#packages/}" "$HERE/specs/scenarios/apg/$(basename "$file")"
done
