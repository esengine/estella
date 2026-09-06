# World residency at scale — what a streamed world costs to hold, and to deliver

Three benches over one subject. `run.mjs` asks what holding a streamed world
costs. `heavy.mjs` asks whether any single arrival is too big to swallow.
`prefetch.mjs` asks the question those two left behind: **does the place get
ready before the player wants it?**

All three drive the real thing — cells arrive over the network into the same
scene lifecycle a game uses — so every number includes what a player would
actually wait through.

## Holding — `node bench/residency/run.mjs`

Generates a 10×10 world of 600-unit cells with 20 colliding props each and takes
three residencies from one source, chosen by radius: its own cell, its 3×3
neighbourhood, its 5×5. The game turns the knob, not the driver.

### Measured 2026-09-05 (M-series Mac, WebGL2, 640×360, 300 frames per level)

```
  level   cells  entities  renderers  bodies  refs   hold/frame   arrive   leave
      1       1        20         20      20     1      0.13 ms  28.91 ms  3.64 ms
      9       9       180        180     180     9      0.27 ms  37.65 ms  3.34 ms
     25      25       500        500     500    25      0.54 ms  35.69 ms  4.83 ms
```

**`arrive` is wall time around a settle poll, not a hitch.** It is how long the
driver waited for residency to finish, and the frames underneath it are cheap —
see the heavy cell below for what an arrival actually costs the main thread.

**Leaving is cheap and flat**: 3–5 ms to destroy a cell's entities, drop its
bodies and give back its receipts, whether that is one cell or twenty-five.

**Holding is linear in content and not in cells**: 0.13 → 0.27 → 0.54 ms a frame
across 20 → 180 → 500 props. That is the props being drawn and simulated; the
count of cells does not appear in it.

**Deciding does not show up at all.** The same world cut into 100 cells and into
4, with nothing resident in either, differ by 6.3 µs a frame — below what this
harness can separate from noise. Residency reconsiders every cell against every
source each frame and, at a hundred cells, that is free.

## The heavy cell — is there an arrival nobody can split?

`node bench/residency/heavy.mjs` builds ONE deliberately heavy cell out of the
third-person sample's own imported assets — a skinned character with an animator,
forty imported props at three levels of detail, two hundred physics bodies, 249
entities — and reads two instruments rather than a stopwatch: the per-cell PHASES
of the load, which run between frames and land on no system timer, and the
per-frame, per-system cost of the frames it arrives on.

The phases split by which HALF of delivery owns them, and that split is the whole
point:

| half | phases | when it can run |
| --- | --- | --- |
| **preparation** | `fetch`, `prefab`, `assets` | any time before demand — this is what prefetch hides |
| **publication** | `spawn` | at the door, however early the readying happened |

### Measured 2026-09-05 (M-series Mac, WebGL2, 640×360, cold, two runs)

```
preparation (hideable)     fetch    2.9 – 3.3 ms
                           assets   4.6 – 7.4 ms
                           = total  7.9 – 10.3 ms

publication (always paid)  spawn    5.9 – 6.4 ms

delivery, issue → resident         15.2 – 17.3 ms

the frame it arrives on              2.8 – 8.4 ms
  on the expensive run, by system:   RenderSystem 6.2, System_2 0.9,
                                     AnimatorSystem 0.8, NavAgentSystem 0.2
```

**There is no unsplittable main-thread phase worth budgeting.** The largest is
about 6 ms of ECS materialization for 249 entities including 200 bodies, and the
frame the cell lands on costs 2.8–8.4 ms — the spread is whether the render side's
registration and upload land on that frame or the next. A scheduler that sliced
this would be buying complexity against a cost already inside a frame.

**What IS worth hiding is the ~8–10 ms of preparation**, and unlike the arrival
frame it is not bounded by anything: it is fetch and decode, so it grows with the
CDN, the content, and how busy the main thread already is. That is the case for
prefetch, and it is a latency argument, not a hitch one.

## Prefetch effectiveness — did it get ready in time?

`node bench/residency/prefetch.mjs` builds a corridor of 16 identical cells
(40 imported props + 160 bodies each) and drives it three times, cold each time,
with the source moving itself so the harness never decides when demand arrives:

| scenario | what it does | what it should find |
| --- | --- | --- |
| **approach** | walks in at 600 wu/s | the cell already `prepared` |
| **teleport** | appears in a cell nobody was near | nothing ready; pays preparation itself |
| **no-prefetch** | the same walk, `prefetchRadius` cut to `loadRadius` | nothing ready — the bench's own falsifier |

A hit is decided **the instant a cell first enters the desired set**, by what
demand finds there. A preparation still in flight is a *miss*, however it ends:
"it was prepared by the time we published it" is true of every cell that ever
loads, and the player waited for it either way.

### Measured 2026-09-05 (M-series Mac, WebGL2, 640×360; load 200 / prefetch 1200 / unload 1300 wu)

Three runs. The counts below were **identical in all three**; the milliseconds
move about ±30%, which is what wall time on a shared machine does.

```
  scenario       requested  hits  misses  cancelled  still ready  hit rate
  approach              11     9       0          0            2      100%
  teleport              10     0       6          8            2        0%
  no-prefetch            0     0       9          0            0        0%

  scenario       arrivals  loadRadius→resident      prepared dwell     preparation  publication
                              p50     p95            p50      p95       (median)     (median)
  approach              9       2.9     5.1          878.5  2297.3           2.4          2.9
  teleport              6       6.3    18.2              —       —           3.4          3.4
  no-prefetch           9       5.1    53.6              —       —           2.3          2.8
```

**A hit costs publication and nothing else.** 2.9 ms at p50 against 2.9 ms of
measured publication — the fetching and decoding are simply not in the number,
and the approach run's slowest arrival (5.1 ms) is still under the teleport run's
median.

**A miss carries the preparation into the wait, and the tail is where it hurts.**
Both miss scenarios reach a p95 of 18–54 ms against the approach's 5.1, and the
worst arrival is always a late one — preparation is measured as *latency*, since
it awaits network and decode across frames, so it degrades as the corridor fills
up and those frames get busier. Prefetch does not care: it stays at 2.9 ms from
the first cell to the ninth.

**The cleanest pairing is the one cold cell.** Every run boots with an empty
cache, so `cell_0_0` is the only cell whose assets nothing had acquired yet — the
same content, the same fetch, the same decode in all three runs:

```
  approach      preparation 15.1 ms  hidden behind a dwell of 471 ms → the player waited   5.1 ms
  teleport      preparation 12.8 ms  paid at the door                → the player waited  18.2 ms
  no-prefetch   preparation 14.5 ms  paid at the door                → the player waited  20.4 ms
```

Same cell, same content, same publication. The only difference is whether
preparation happened before demand.

### The falsifier, and what it is worth

`no-prefetch` is not a separate feature path — it is the same walk with
speculation reaching no further than demand. It collapses from 9 hits to 0. If it
ever does not, the approach row was never measuring prefetch, and this bench
should be believed about nothing.

### What the dwell says

`prepared dwell` is how long readiness sat before anything wanted it: 0.9 s at
p50, 2.3 s at p95, against a preparation that takes 2–17 ms. Readiness waits
**two to three orders of magnitude longer than it took to produce**, and two
speculations were still unclaimed when the walk ended. The radius is generous,
and the teleport run's 8 cancellations are what generosity costs when a source
does something unexpected.

That is the data a later cut would use to argue for velocity prediction, an
adaptive radius, or a memory budget. **None of them are being built now** — the
hit rate is 100% on the motion prefetch exists for, and the waste is bounded by
the radius.

Two caveats on reading these numbers. The dwell is harness wall time, and this
harness steps frames as fast as it can rather than at 60 Hz, so it understates
the game-time lead — which by construction is `(1200 − 200) / 600 = 1.67 s` of
walking. And the corridor's 16 cells share three rock meshes, so only the first
cell of a run pays a real `assets` phase; the rest are fetch-and-spawn. The
cold-cell block above is where a whole preparation is on show.

### An authoring rule the measurement forced

`prefetchRadius` must not exceed `unloadRadius`. The streamer knows how far a
source is and never which way it is going, so a cell that leaves the unload band
while still inside the prefetch radius is speculated about again the instant it
goes — walking away from a place fetches it a second time. Held to in
`sdk/tests/world-residency.test.ts`, both directions.

## Streaming Delivery v1 — frozen

What the three benches together establish:

- **Residency** decides what should exist, and deciding is free (6.3 µs per 100
  cells, below the noise floor).
- **Delivery** readies content before demand, and it works: 100% hit rate on
  ordinary movement, 0% when speculation is disabled, and a hit costs publication
  alone.
- **Publication** is the only cost demand cannot escape: ~6 ms of spawn for a
  249-entity cell, landing on a 2.8–8.4 ms frame. Nothing here needs a budget
  scheduler.
- **Cancellation** gives back what speculation acquired, receipts included.

Not in v1, deliberately: velocity prediction, adaptive prefetch radius, memory
budget, priority scheduling. Each of them now has a number that would justify it,
and none of them has one yet.

### Instrumentation

The earlier note here said the per-system breakdown of an arrival frame "comes
back empty". That was the driver's probe and not the profiler: `costs()` called
`enableStats()` on every read, which swapped the maps the frame had just filled,
so the engine reported costing nothing. Engaging once fixed it, and the
breakdowns above are real. No profiler lifecycle was changed.
