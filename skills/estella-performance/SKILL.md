---
name: estella-performance
description: How to find and fix what makes an Estella game slow - measure the frame before touching anything, tell CPU from GPU from waiting, find the system or the draws that cost, apply the fix the engine already has (batching, LOD, quality levels, gated systems), and prove the gain with the same measurement on the device it ships to. Read it before optimizing, and before saying a game runs well.
---

# Performance

Never say a game is fast or slow without a number, and never fix what was not measured. The loop is: measure, find the
one largest cost, change one thing, measure again the same way.

## Measure honestly

- Measure the RUNNING game: `set_play { state: "playing" }`, then `step` a few hundred frames so shaders, streaming and
  generation are warm. The first frames of anything are not its cost.
- `profile_frames` says where the frame went: `cpuMs` (work), `gpuMs`, and `waitMs`, which is the CPU waiting for the
  display and NOT a hotspot. `stalled: true` means no frame ran: say so, do not read the zeroes as fast. An editor
  window in the background runs at about 1 FPS, and that is not a result either.
- Read p95 and p99 and the long frames, not only the average: a stutter is one bad frame the average hides.
- This machine is not the target. A phone's CPU is several times slower than a desktop's: a system costing 0.5 ms
  here is 2 or 3 ms of a phone's 16. Judge desktop numbers at that scale, and measure on the device when it matters:
  a development build (`export_game { debugChannel: true }`) appears in `device_targets`, then
  `set_profiler_source { source: realm }` points `profile_frames` and `capture_frame` at it. A game can also record a
  `.esprof` with `ProfileRecorder` on a player's device; `profile_capture` reads it, `worstFrame` first.
- Measure before and after the same way: same scene, same camera, same frames stepped. Two runs differ by noise;
  repeat and take the better of each before believing a small gain.

## CPU: which system

`profile_frames` lists cost per domain (scripts, render, physics, ui) and the costliest systems with what their
queries walked. `get_systems` gives the same per frame.

- `filtered` near `scanned` is a system walking the whole world to throw it away. Query for the component it needs,
  or use a change filter that skips, not one that visits.
- A system that runs every frame for a feature the scene may not use is gated with `activeWhen`:
  `app.addSystemToSchedule(schedule, system, { activeWhen: [MyComponent] })` skips it while no entity has the component.
- A frame where nothing changed should cost almost nothing. Writing a component every frame with the value it already
  has makes everything downstream redo its work (a UI write lays the whole tree out again): write only on change.
- Allocation in a per-frame loop (new objects, arrays, closures) comes back as garbage-collection long frames.

## GPU and draws

`get_stats` is one cheap frame: `drawCalls` (the lists') against `gpuDraws` (every pass: shadows, depth, reflections
multiply the first), triangles, GPU memory, against the quality level's budget. Then `capture_frame` lists every draw
with `breakReason`, why it could not join the draw before it, and `breaks` counts the reasons: start with the largest.
`frame_draws` pages through it; `replay_draw` shows what one draw put on screen.

- `Material` or `TextureSlots` breaks: share materials, pack sprites into an atlas (a `<name>.atlas/` folder).
- Many meshes that never move: `StaticBatch` on them merges each neighbourhood into one draw. Skinned, blended and
  moving meshes are left out, and the component says why.
- Far things drawn in full: a `LODGroup` with thresholds as fractions of screen height; `get_lod_decision` says which
  level a view picked and why.
- Shadows: `gpuDraws` far above `drawCalls` is usually shadow passes. Short grass and small props cast none
  (`castShadows` off); `get_shadow_status` says what the atlas gave a caster.
- Pixels: when the frame costs the same with half the objects, the cost is per pixel (overdraw, post effects, a full
  resolution on a dense screen). Quality levels (Project Settings, rendering) hold the render scale, effects and
  budgets per device class; a phone defaults to Medium. Lower the level's cost there, not in the scene.
- Plants and terrain: `audit_vegetation` before adding; budget cells, plants per cell, LOD and shadows together.

## Memory and leaks

`get_stats` shows GPU memory and what texture streaming holds; compressed textures (`estella-shipping`) cut VRAM as well as
download. For "it gets slower over time", take `resource_census` before and after a Play and Stop (or a scene load):
every counter tagged `conserved` must come back to the same number, and the one that did not is the leak.

## Report

The measurement, what it pointed at, the one change, and the same measurement after, with where it was taken (editor
play, or which device). "Should be faster" is not a result; if the number did not move, undo the change and say so.
