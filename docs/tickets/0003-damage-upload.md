---
id: 0003
title: Only the changed rectangle goes to the texture
type: task
status: closed
blocked_by: [0001]
---

## Goal

Both windowed hosts upload the whole pixel buffer every drawn frame:
`SDL_UpdateTexture(texture, NULL, pixels, …)` (`desktop/host.c`, `solid/native/ui.c`). At 360×360
and pixel density 2 that is 2 MB a frame; a 1200×630 card at 2× is 12 MB. A key typed into one
field changes a few thousand pixels.

## Scope

- `desktop/clay_frame.c`: `Clay_FrameDiff` gives the box two frames differ in — the union of the
  bounding boxes of the commands that differ (both sides, so a command that moved covers where it
  was and where it is); the whole frame when the command count changed.
- `host.c` and `ui.c`: `SDL_UpdateTexture` with that rectangle and a row offset, and only when the
  frame drew. The quad is still presented whole: the texture holds the last frame everywhere else,
  and a scaled present of one rect would need the logical-presentation mapping.
- The Solid host's frames carry side tables (shadows, backdrops, gradients) that a command diff
  cannot see: when either frame has a shadow or a backdrop, the damage is the whole frame (a blur
  reaches past the box). A change that the command diff cannot explain is also the whole frame.

## Acceptance

- Bytes uploaded per drawn frame, printed by a `--stats` line: from `w×h×4` to the damage box's.
  On the sensors page, a theme key (`t`) must stay under 25 % of the buffer.
- Pixels are unchanged: every golden and every scene still passes, and a windowed frame is
  byte-identical to the headless one (`--png` vs the presented buffer, compared in the test).
- `sh test.sh` green.

## Not doing

Multiple rectangles. One union box is the lazy version and costs nothing to reason about; a
scattered change (a caret and a status line) uploads the band between them. Split it only if a
page's measured upload is dominated by the union's slack.

## Resolution

`Clay_FrameDiff`'s box is what `SDL_UpdateTexture` uploads, in both hosts; the quad is still presented whole.

| scene | uploaded per draw |
|---|---|
| `list-select` (a list scrolling) | **39 %** of a frame |
| `widgets-switch-on` (a toggle) | **8 %** |
| `dialog-menu` (a shadow) | 71 % — the shadow's frames are whole by design |

Correctness: every scene and every stored frame in `test.sh` is byte-identical; the C host's
`CSSINTS_PRESENT_CHECK=1` draws the frame again through a box, presents it and reads the window back against the buffer
(`present check: identical (0 pixels differ)`). A resize and a density change set the drawn frame to none, so the next
frame is whole.
