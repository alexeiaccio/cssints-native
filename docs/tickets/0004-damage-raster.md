---
id: 0004
title: Only the changed rectangle is rasterised
type: prototype
status: closed
blocked_by: [0003]
---

## Goal

A drawn frame rasterises every command into the whole buffer and clears it to black first
(`ui_draw`, `draw` in `host.c`). Tuios' `keptCanvas` shows what the other end looks like: when the
layer set is the last frame's, the canvas is not cleared and only the direct pane's changed cells
are copied — a keystroke costs 200 cells, not 12,000.

ThorVG's software canvas has the two pieces this needs: `tvg_canvas_set_viewport` clips rendering
to a rectangle, and the target buffer is ours to keep between frames.

## Scope

- Keep the buffer across frames; clear only the damage box instead of the whole target.
- Set the canvas viewport to the damage box before the frame's scene is added, and to the whole
  target when the frame is a full one. The WebGPU canvas is excluded: its target is a swapchain
  the host does not own.
- The renderer keeps the box in `Clay_ThorVGRendererData` (a `Clay_ThorVG_SetDamage` call beside
  the frame), so no caller has to pass a rectangle through the existing signature.

## Acceptance

- Raster time for a frame that changes one element, against the same frame drawn whole, on a
  1200×630 page at 2× and on the 360×360 sensors page.
- **Pixel-identical to a full frame**: every stored golden and every scene (`solid/main.ts --scene
  … --expect …`, `desktop/host.c --scene … --expect …`) replayed with partial raster must equal
  the frame the full raster draws. This is the gate; a faster wrong frame is not a result.
- If the numbers do not clear the noise (the raster is 0.3 ms at 360×360), close this ticket with
  the measurement and leave the full raster in place — that is a result too.

## Resolution

Landed: the target keeps the last frame, only the damage box is erased, and `tvg_canvas_set_viewport` clips the raster to
it (the WebGPU canvas excluded — its target is a swapchain).

| scene | raster, damaged | raster, whole | |
|---|---|---|---|
| `list-select` 360x400 | 31.6 / 34.6 ms | 39.4 / 48.8 ms | −20 to −29 % |
| `widgets-switch-on` 360x760 | 2.1 / 2.4 ms | 3.3 / 3.6 ms | −30 % |
| `dialog-menu` 360x480 | 26.1 / 30.3 ms | 25.5 / 32.7 ms | none: the shadow's frames are whole |

The clipping works: forcing a 16x16 box on `list-select` took its 87 draws from 46–56 ms to 12–14 ms. So the win is
real and bounded by the damage — and on these pages the damage is often most of the frame (a scrolling list, a menu over
a dimmed page). A bigger win needs the scene kept between frames instead of rebuilt and clipped: a paint per element,
mutated in place, which is the next ticket if a page ever draws enough to justify it.

Correctness gate passed: all scenes and every stored frame in `test.sh` are pixel-identical to the whole-frame raster,
and the C host's present check compares the presented window with the buffer.
