#!/bin/sh
# The specs this package generates, written again from their sources and compared byte for byte with the files in git, so a
# page, a spring, the map or the recording that changed is this `cmp` and not a stale drawing:
#
#   the two pages' frames       before-after, layer-stack, modal, transition-spec   specs/from-frames.ts
#   the Widgets page's cut      screen, anatomy                                     specs/from-page.ts
#   the pages' style modules    state-matrix                                        specs/from-styles.ts
#   the solver and the app's    motion-timing, easing, stagger, frame-strip,         specs/from-motion.ts
#     curves                      easing-table
#   the Jetstream recording     cohort                                              specs/from-cohort.ts
#   docs/map.md                 table (its Targets table), timeline (its plan)      specs/from-targets.ts, from-map.ts
#
# A spec that is not here is one whose source is not: the design-system kinds come from the web app's token file and the
# forecast from the repository's CHANGELOG, both in the cssints repository. Their specs and frames are stored data here;
# the generators and the `cmp` are there.
#
#   sh solid/figure-handoff.sh        # from anywhere (it cds)
set -e
cd "$(dirname "$0")/.."
FIG="${TMPDIR:-/tmp}/cssints-native-figure-handoff"
rm -rf "$FIG"
mkdir -p "$FIG/specs"

bun solid/specs/from-frames.ts "$FIG/specs" >/dev/null
bun solid/specs/from-page.ts "$FIG/specs" >/dev/null
bun solid/specs/from-styles.ts "$FIG/specs" >/dev/null
bun solid/specs/from-motion.ts "$FIG/specs" >/dev/null
bun solid/specs/from-cohort.ts "$FIG/specs" >/dev/null
bun solid/specs/from-targets.ts "$FIG/specs" >/dev/null
bun solid/specs/from-map.ts "$FIG/specs" >/dev/null

for spec in before-after layer-stack modal transition-spec screen anatomy state-matrix \
  motion-timing easing stagger frame-strip easing-table cohort table timeline; do
  cmp "$FIG/specs/$spec.json" "solid/specs/$spec.json" || {
    echo "FAIL: solid/specs/$spec.json is not what its generator writes; commit its output"
    exit 1
  }
done
echo "figure handoff: 15 generated specs are their generators', byte for byte (cmp)"
