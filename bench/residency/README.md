# World residency at scale — what a streamed world costs to hold

`node bench/residency/run.mjs` generates a 10×10 world of 600-unit cells with 20
colliding props each, packages it, and drives the real thing: cells arrive over
the network into the same scene lifecycle a game uses, so every number here
includes what a player would actually wait through.

Three residencies come from one source, chosen by radius — its own cell, its 3×3
neighbourhood, its 5×5 — and the game turns the knob, not the driver.

## Measured 2026-09-05 (M-series Mac, WebGL2, 640×360, 300 frames per level)

```
  level   cells  entities  renderers  bodies  refs   hold/frame   arrive   leave
      1       1        20         20      20     1      0.13 ms  28.91 ms  3.64 ms
      9       9       180        180     180     9      0.27 ms  37.65 ms  3.34 ms
     25      25       500        500     500    25      0.54 ms  35.69 ms  4.83 ms
```

**`arrive` is the hitch, and it is the number this exists to publish.** Bringing a
place in costs tens of milliseconds — fetching the cell document, spawning its
entities, handing its bodies to the physics world and acquiring its assets — and
this version does none of that on a budget. Twenty-five cells arrive in about the
same wall time as one because the loads are issued together and overlap; what
does not overlap is the spawning, which is why 25 is not 25× of 1 either.

**Leaving is cheap and flat**: 3–5 ms to destroy a cell's entities, drop its
bodies and give back its receipts, whether that is one cell or twenty-five.

**Holding is linear in content and not in cells**: 0.13 → 0.27 → 0.54 ms a frame
across 20 → 180 → 500 props. That is the props being drawn and simulated; the
count of cells does not appear in it.

**Deciding does not show up at all.** The same world cut into 100 cells and into
4, with nothing resident in either, differ by 6.3 µs a frame — below what this
harness can separate from noise. Residency reconsiders every cell against every
source each frame and, at a hundred cells, that is free.

## What the numbers do not include

There is no priority, no prefetch and no budget yet, so a large cell arriving is
a hitch of its full size. `arrive` is measured over localhost: a real CDN adds
its own latency on top of the spawning cost, and only the spawning half of these
numbers is the engine's.

## The heavy cell — is there an arrival nobody can split?

`node bench/residency/heavy.mjs` builds ONE deliberately heavy cell out of the
third-person sample's own imported assets — a skinned character with an animator,
forty imported props at three levels of detail, two hundred physics bodies, 249
entities — and reads two instruments rather than a stopwatch: the per-cell PHASES
of the load, which run between frames and land on no system timer, and the
per-frame cost of the frames it arrives on.

### Measured 2026-09-05 (M-series Mac, WebGL2, 640×360, cold)

```
preparation (between frames, each phase atomic on the main thread):
  spawn      7.00 ms      ← the largest atomic phase there is
  assets     6.20 ms
  fetch      4.70 ms
  delivery  19.00 ms      issue → resident

the frame it arrives on:  3.50 ms
```

**There is no unsplittable main-thread phase worth budgeting.** The largest is
7 ms of ECS materialization for 249 entities including 200 bodies, and the frame
the cell lands on costs 3.5 ms. A scheduler that sliced this would be buying
complexity against a cost that is already inside a frame.

**What IS worth hiding is the 19 ms of delivery.** Nineteen milliseconds is a
player walking into a place that is not there yet for a dozen frames — and every
part of it (fetch, asset acquisition, spawning) can happen before they arrive.
That is the case for prefetch, and it is a latency argument, not a hitch one.

One thing this cannot say: the arrival frame's 3.5 ms is a total, not a split
between physics registration, render registration and animation. The per-system
breakdown the driver asks for comes back empty here — the frame costs are
engaged but not filled by the time the profile reads them. The verdict does not
rest on it: a 3.5 ms frame cannot hide a 15 ms phase.
