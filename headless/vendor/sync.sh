#!/bin/sh
# Copy the spec side of @eoa/headless's tests from effects-of-atmosphere (read-only there) and record its commit.
# Usage: sh vendor/sync.sh [path to effects-of-atmosphere]
set -e
EOA="${1:-$HOME/github/effects-of-atmosphere}"
HERE="$(cd "$(dirname "$0")" && pwd)"
P="button switch checkbox disclosure"

mkdir -p "$HERE/quint-machine/src" "$HERE/specs/src/apg" "$HERE/specs/scenarios/apg" "$HERE/specs/specs/apg"
cp "$EOA/packages/quint-machine/src/core.ts" "$EOA/packages/quint-machine/src/runtime.ts" "$HERE/quint-machine/src/"
# the package index also re-exports scxml.ts, which the tests do not need
grep -v scxml "$EOA/packages/quint-machine/src/index.ts" > "$HERE/quint-machine/src/index.ts"
cp "$EOA/packages/specs/src/scenario.ts" "$HERE/specs/src/"
for p in $P; do
  cp "$EOA/packages/specs/src/apg/$p.bridge.ts" "$EOA/packages/specs/src/apg/$p.model.generated.json" "$HERE/specs/src/apg/"
  cp "$EOA/packages/specs/scenarios/apg/$p".*.json "$HERE/specs/scenarios/apg/"
  cp "$EOA/packages/specs/specs/apg/$p.qnt" "$HERE/specs/specs/apg/"
done
cp "$EOA/packages/specs/scenarios/apg/README.md" "$HERE/specs/scenarios/apg/"
git -C "$EOA" rev-parse HEAD > "$HERE/EOA_COMMIT"
