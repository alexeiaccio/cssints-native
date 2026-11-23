---
id: 0002
title: At rest the C host sleeps on an event, not on a 16 ms timer
type: task
status: closed
blocked_by: [0001]
---

## Goal

`desktop/host.c` ends every iteration with `SDL_Delay(16)`, so a settled page wakes the process
**62 times a second** to lay out a frame it then does not draw. Tuios counts this as its idle
invariant (`0 render/tick`, `0 idle wire bytes` over 10 s); the board (`esp32` `clay-test`) already
behaves that way — `drawn 0.0/s`, `busy 1 %`.

## Scope

- A frame that drew nothing puts the loop into `SDL_WaitEvent` — no timeout, no wakeups until input.
- A frame that drew something waits 16 ms (`SDL_WaitEventTimeout`), so anything that is still
  moving — Clay's scroll momentum, a transition, a page's own tick — keeps its clock. When it
  settles, one unchanged frame puts the loop back to sleep.
- Clamp `dt` (a blocked loop can return after seconds) to 100 ms, so a scroll or a transition does
  not jump.

## Acceptance

- `build/sensors/app` at rest: wakeups/s and CPU. Target: no wakeup at all after the last change,
  CPU ≤ 1 %.
- Input still responds: a click on the page's controls and the `t` theme key draw on the next frame.
- Goldens unchanged; `sh test.sh` green.

## Not doing

The Solid host keeps its `Bun.sleep(16)` tick: a page's tick runs on it and nothing tells the host
when a page next needs a frame. It costs 1.9 % and is not this ticket. If a C page ever keeps its
own clock (a seconds hand), it needs the same "wake me at T" answer — no page has one today.

## Resolution

The C host waits in `SDL_WaitEvent` after a frame that drew nothing, and in `SDL_WaitEventTimeout(16)` after one that
drew, so a scroll's momentum or a transition keeps its clock and a settled page has no wakeup at all. `dt` is clamped to
100 ms. Measured: the idle process reports `0.0 %` CPU and two frames (one drawn, one skipped) before it sleeps — there
is no tick to count because there is no tick.

The Solid host is unchanged: a page's tick runs on its `Bun.sleep(16)` and nothing tells the host when a page next needs
a frame. Its idle cost was 1.9 % before and 0.6–1.5 % after (the presents it makes are smaller, but at rest it makes
none, so the difference is noise).
