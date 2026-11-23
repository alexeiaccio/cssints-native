---
id: 0001
title: The C host draws when the frame changes, not on a clock
type: task
status: closed
blocked_by: []
---

## Goal

The C examples' host (`desktop/host.c`) draws, uploads and presents every 16 ms whether or not
the frame changed. A page at rest costs **11.4 % of a core** (measured on an M-series Mac,
`build/sensors/app`, 360×360, Metal + ThorVG, 4 s idle, `ps -o %cpu`) while its raster is 0.31 ms
a frame — the rest is layout, texture upload and present, 60 times a second.

The Solid host already does this right: `solid/src/frame.ts` lays out every iteration but calls
`ui_draw` only when `ui_hash` changed or a discrete input arrived, and presents only then. Its idle
cost is **1.9 %** (`bun solid/main.ts`, same machine, same 5 s).

## Scope

- Hash the frame's render commands (the fields a draw reads; text by its bytes) in
  `desktop/clay_frame.c`, shared by both hosts.
- `host.c`: after `Clay_EndLayout`, draw + upload + present only when the hash changed or the
  iteration carried a discrete input (key, button, wheel); skip both otherwise.
- Keep `--png`, `--expect`, `--dump`, `--scene` and `--bench` exactly as they are: they draw every
  frame they are asked for and their goldens must not move.

## Acceptance

- Idle CPU of `build/sensors/app` with a window: from 11.4 % to ≤ 3 %.
- A pointer move inside one element draws nothing (`--stats` counter: draws / frames).
- Every stored golden still passes (`--expect`, `--scene`), and `sh test.sh` is green.

## Not doing

Layout is not skipped: Clay's hit test reads the last frame's boxes, and the pages declare their
tree every frame. At 0.3 ms a frame the layout is not the cost; the raster, upload and present are.

## Resolution

`desktop/clay_frame.c` (the diff) and `desktop/host.c` (the decision) landed. The C host lays out every iteration and
draws, uploads and presents only a frame that differs from the one on screen; the headless paths (`--png`, `--expect`,
`--dump`, `--scene`, `--bench`) still draw every frame they are asked for, so no golden moved.

Idle, Sensors 360x360, four seconds, three runs: **11.4 % of a core → 0.0 %**; the counters read
`stats: 2 frames, 1 drawn, 1 skipped, … asleep`. `--bench 200` still prints 0.306 ms of raster a frame.

The pointer case is the same path as the second frame there (a laid-out frame that differs in nothing is skipped); a
synthetic click could not be posted from this machine (System Events is not permitted), so the input side is held by
the code path and by the scenes, not by an injected event.
