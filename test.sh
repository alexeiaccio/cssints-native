#!/bin/sh
# The whole package on a machine that can draw: the C side and the headless widgets (check.sh and the walk, which CI also
# runs), the terminal's wire, the pixel diff, the figure suite and the generated specs' `cmp`. The frames it draws need SDL3
# and ThorVG (brew on macOS): a machine without them runs `sh check.sh` and `bun run test:headless` only, which is what CI
# does.
#
#   sh test.sh
set -e
cd "$(dirname "$0")"
sh check.sh
node focus/test/focus.test.ts
node terminal/system.test.ts
bun solid/diff.test.ts
(cd headless && bun run typecheck:native && bun run test:native)

# The figure suite: a test a kind or an area, each drawing its frames and reading them back.
cd solid
bun figure-anatomy.test.ts
bun figure-charts.test.ts
bun figure-cohort.test.ts
bun figure-easing-table.test.ts
bun figure-export-deck.test.ts
bun figure-export.test.ts
bun figure-file-sample.test.ts
bun figure-handoff.test.ts
bun figure-label-lang.test.ts
bun figure-modal.test.ts
bun figure-motion.test.ts
bun figure-planning.test.ts
bun figure-registry.test.ts
bun figure-table.test.ts
bun figure-text.test.ts
bun figure-transition-spec.test.ts
bun figure-wireframe.test.ts
bun figure.test.ts
cd ..

# ... and the specs that are generated: written again from their sources and compared with the files in git.
sh solid/figure-handoff.sh
echo "test: the C, the widgets, the terminal's wire and the figures are green"
