---
section: Changed
commits:
  - perf(water): a water zone is baked on a worker, and the first bake of a scene is shown even when the ground settling overtakes it
---
**Water appears seconds sooner, most of all in the editor.** A water zone's field was baked on the main
thread in slices of a few milliseconds a frame, so it took as many frames as the work had slices: in an
editor drawing a busy scene at a dozen frames a second, the water of the Terrain & Water example came after
about 17 seconds, and every frame of that paid for it. The bake now runs on a worker: the main thread only
reads the ground's heights and takes the finished field. And when the ground changed under a bake still
running (a scene's terrain settling as it loads), that bake was thrown away and the water waited for the
next; now the first is shown and the next replaces it. Where a host has no workers (a mini-game, a test in
Node) the bake runs on the main thread as before.
