#!/bin/sh
# The handoff, QA and wireframe figures' desktop half: the three stored frames are the page at rest, and
# `before-after.json` is what `specs/from-frames.ts` writes from two frames of the Widgets page, `layer-stack.json` and
# `modal.json` from the Dialog's modal and menu frames, `app-shell.json` and `card-grid.json` from the Sky page's frame,
# and `list-detail.json` from the same page wide with its thread open — the same discipline as `from-tokens.ts`: a stale
# spec is this `cmp`, not a review note. `table.json` is here too: `specs/from-targets.ts` reads the Targets table of
# `native/docs/map.md`. `forecast.json` is
# `specs/from-releases.ts`'s count of `CHANGELOG.md`'s dated releases, and `cohort.json` is `specs/from-cohort.ts`'s
# arithmetic on the recorded Jetstream sample (`samples/jetstream.json`, collected once).
# The motion half's two frame-derived specs are here as well: `intent-card.json` is the Sky feed's third card's nine
# frames (each the group effect the page drew), and `transition-spec.json` is the Dialog's menu at the dialog-menu
# scene's entry and settle.
#
#   sh solid/figure-handoff.sh        # from native/, or from anywhere (it cds)
#
# The three frames are the page's at rest (`--warm 30`), as every other figure's; the two Widgets frames the spec is made
# from are the switch off (`Tab,Tab`, focused) and on (`Tab,Tab,Space`), captured in-process by solid/dump.ts.
set -e
cd "$(dirname "$0")/.."
FIG="${TMPDIR:-/tmp}/cssints-figure-handoff"
mkdir -p "$FIG/specs"
bun solid/main.ts figure --spec solid/specs/redline.json --warm 30 --expect solid/frames/figure-redline.png
bun solid/main.ts figure --spec solid/specs/before-after.json --warm 30 --expect solid/frames/figure-before-after.png
bun solid/main.ts figure --spec solid/specs/qa-checklist.json --warm 30 --expect solid/frames/figure-qa-checklist.png
bun solid/specs/from-frames.ts "$FIG/specs" >/dev/null
cmp "$FIG/specs/before-after.json" solid/specs/before-after.json || {
  echo "FAIL: solid/specs/before-after.json is not what specs/from-frames.ts writes from the two Widgets frames; commit its output"
  exit 1
}
cmp "$FIG/specs/layer-stack.json" solid/specs/layer-stack.json || {
  echo "FAIL: solid/specs/layer-stack.json is not what specs/from-frames.ts writes from the Dialog's modal and menu frames; commit its output"
  exit 1
}
cmp "$FIG/specs/modal.json" solid/specs/modal.json || {
  echo "FAIL: solid/specs/modal.json is not what specs/from-frames.ts writes from the Dialog's modal frame; commit its output"
  exit 1
}
# the generic table's data is the map's Targets table: a target added, renamed or re-worded there is this cmp
bun solid/specs/from-targets.ts "$FIG/specs" >/dev/null
# the cohort grid's data is the Jetstream recording: a re-collected sample is a rewrite here and this cmp, not a note
bun solid/specs/from-cohort.ts "$FIG/specs" >/dev/null
cmp "$FIG/specs/cohort.json" solid/specs/cohort.json || {
  echo "FAIL: solid/specs/cohort.json is not what specs/from-cohort.ts writes from solid/samples/jetstream.json; commit its output"
  exit 1
}
cmp "$FIG/specs/table.json" solid/specs/table.json || {
  echo "FAIL: solid/specs/table.json is not what specs/from-targets.ts writes from native/docs/map.md's Targets table; commit its output"
  exit 1
}
# the forecast's data is this repository's release cadence: specs/from-releases.ts reads CHANGELOG.md's dated headings
bun solid/specs/from-releases.ts "$FIG/specs" >/dev/null
cmp "$FIG/specs/forecast.json" solid/specs/forecast.json || {
  echo "FAIL: solid/specs/forecast.json is not what specs/from-releases.ts writes from CHANGELOG.md; commit its output"
  exit 1
}

cmp "$FIG/specs/app-shell.json" solid/specs/app-shell.json || {
  echo "FAIL: solid/specs/app-shell.json is not what specs/from-frames.ts writes from the Sky page's frame; commit its output"
  exit 1
}
cmp "$FIG/specs/card-grid.json" solid/specs/card-grid.json || {
  echo "FAIL: solid/specs/card-grid.json is not what specs/from-frames.ts writes from the Sky page's frame; commit its output"
  exit 1
}
cmp "$FIG/specs/list-detail.json" solid/specs/list-detail.json || {
  echo "FAIL: solid/specs/list-detail.json is not what specs/from-frames.ts writes from the wide Sky page's frame with the thread open; commit its output"
  exit 1
}
cmp "$FIG/specs/intent-card.json" solid/specs/intent-card.json || {
  echo "FAIL: solid/specs/intent-card.json is not what specs/from-frames.ts writes from the Sky feed's card frames; commit its output"
  exit 1
}
cmp "$FIG/specs/transition-spec.json" solid/specs/transition-spec.json || {
  echo "FAIL: solid/specs/transition-spec.json is not what specs/from-frames.ts writes from the Dialog menu's two frames; commit its output"
  exit 1
}
echo "figure handoff: the frames are the page's, and before-after.json, layer-stack.json, modal.json, app-shell.json, card-grid.json, list-detail.json, intent-card.json, transition-spec.json, table.json and cohort.json are their sources', byte for byte (cmp); forecast.json comes from CHANGELOG.md's dated releases (from-releases.ts)"
# ... and the same three in the browser, by name: browser/solid/figure.ts fetches the same files with `?spec=`, and
# browser/figure-handoff-check.mjs holds each frame to its golden within 4px (Canvas2D's advance against ThorVG's).
if command -v zig >/dev/null 2>&1 && command -v bun >/dev/null 2>&1 &&
   node -e 'process.exit(require("node:fs").existsSync(require("playwright").chromium.executablePath()) ? 0 : 1)' 2>/dev/null; then
  bun browser/solid/build.ts >/dev/null
  node browser/figure-handoff-check.mjs
else
  echo "figure handoff, in a browser: no zig, bun or Playwright chromium, skipped (bun browser/solid/build.ts && node browser/figure-handoff-check.mjs)"
fi
