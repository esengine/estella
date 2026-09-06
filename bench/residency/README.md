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

## The heavy cell — what does one arrival cost, and when?

`node bench/residency/heavy.mjs` builds ONE deliberately heavy cell out of the
third-person sample's own imported assets — a skinned character with an animator,
forty imported props at three levels of detail, two hundred physics bodies, 249
entities — and walks into it **twice, from a cold cache each time**:

| arm | how the cell is reached | what it isolates |
| --- | --- | --- |
| **miss** | demanded before anything readied it | preparation on the critical path |
| **hit** | readied first, then demanded | the path prefetch exists to create |

Two arms and not one, because readying early does not make the work cheaper. It
moves **when** the work is paid, and that turns out to be the whole story.

### Three costs, and they are not one number

The old reading of this bench had a single boundary and called it "publication".
There are two, and the second is larger:

```
publicationCost         prepared data  →  ECS-visible
                        spawn, component writes, hierarchy, adoption

firstVisibleFrameCost   ECS-visible    →  actually drawn
                        renderer registration and upload, on ONE frame

arrivalWindowCost       the same, summed over the frames the arrival disturbs,
                        above the steady state those frames would otherwise cost
```

**Finishing the publication transaction is not having paid for the arrival.**

### Four arms, because two could not tell publication from visibility

| arm | what it does | what it isolates |
| --- | --- | --- |
| **miss** | demanded before anything readied it | preparation on the critical path |
| **hit** | readied first, then demanded | the path prefetch exists to create |
| **zero** | never brings a cell in | whether the renderer spikes on its own |
| **blind** | publishes with the camera turned away, then turns it back | publication vs first visibility |

`zero` never spikes, so no shape below is something the renderer does anyway.
`blind` publishes with nothing drawn and costs nothing, then costs 6.2 ms the
moment the camera turns — which is what makes the author **first visibility** and
not publication.

### Measured 2026-09-05 (M-series Mac, WebGL2, 640×360, cold, one run per arm)

```
                              miss          hit
  preparation (hideable)     8.80 ms       9.40 ms     issue → prepared
    accounted                96.6%         95.7%

  publicationCost            7.10 ms       6.40 ms     between frames | INSIDE the frame
    accounted                98.6%        104.9%

  firstVisibleFrameCost      2.50 ms      13.30 ms     dearest single frame
  arrivalWindowCost          1.53 ms      14.19 ms     over 4 / 5 frames
    accounted                (noise)       96.0%
```

**On a hit, the arrival lands on one frame — all of it.** The cell becomes
resident on frame 0 of the profile, and that frame costs 13.30 ms:

```
  f0   13.30 ms   render 6.70, scene 5.90, scripts 0.10
  f1    2.70 ms   animation 0.80, nav 0.30, …
  f2    0.70 ms   (steady state, 0.80 ms)
```

`scene` is where `WorldResidencySystem` reports, so that row IS the publication
transaction; `render` beside it is the realization of what publication just
spawned. **Prefetch stacks two ~6 ms halves into the same frame.**

**On a miss the same work is split.** Publication runs between frames (7.10 ms
on no system timer at all) and realization lands on a later frame on its own. The
player waits longer — but no single frame carries both.

So the honest summary of what prefetch bought:

| | miss | hit |
| --- | --- | --- |
| what the player waits | longer | **shorter** |
| worst single frame | smaller | **13.3 ms — 80% of a 60 Hz budget** |

Prefetch did not remove the work. It removed the *waiting* and concentrated the
*work*.

### How the publication transaction is measured, and against what

Every phase is emitted through the scene loader's existing `onPhase` sink, whose
names nest on dots (`spawn.components.MeshRenderer` is inside `spawn.components`
is inside `spawn`), so a reader sums the roots and never the whole list:

```
  publicationCost, hit arm
    spawn                    5.90 ms
      components             4.40 ms
        MeshRenderer         1.50 ms
        Transform            1.30 ms
        RigidBody3D          0.80 ms
        BoxCollider3D        0.30 ms
        MeshSkin             0.20 ms
        LODGroup             0.20 ms
        Animator             0.10 ms
      migrate                0.50 ms   ← a JSON deep-clone of the whole document
      entities               0.40 ms
      validate               0.30 ms
      hierarchy              0.20 ms
    adopt                    0.20 ms   ← one `SceneOwner` insert per entity
    transform                0.10 ms
    origins / spine          0.00 ms
```

Four of these had no timer at all before this cut: `origins`, `transform`,
`adopt` and `spine` all run after `spawn` inside `publishRuntimeScene`, and every
one of them is per-entity work.

**The transaction has no single independent parent, and which clock can see it
depends on the path.** On a miss it runs between frames, so the streamer's own
publish-to-resident wall time brackets it and nothing else (7.10 named against
7.20 measured — 98.6%). On a hit that wall time is useless: the transaction runs
inside the frame that asked, and the promise it returns settles only once the
frame's *remaining systems* — the renderer included — have run, so it reads
12.8 ms and describes the whole frame. What brackets it there is the frame
profiler's `scene` domain, a different instrument on a different clock: 6.40
named against 6.10 measured (104.9%). The check is two-sided, because a one-sided
one passes by over-counting.

### The budget line, and why this is not frozen

An arrival may have **half** a 60 Hz frame, because the game needs the other
half. This fixture's steady state is 0.8–1.0 ms a frame — a nearly empty world —
so passing here would say nothing about a real game, while failing says something
about every one:

```
  miss   1.48 ms of arrival work against 8.33 ms of headroom   ✓
  hit   12.50 ms of arrival work against 8.33 ms of headroom   ✗
```

**The hit path violates the budget, and the hit path is the one prefetch exists
to produce.** That is measured, not projected, and it is why Streaming Delivery
v1 is not frozen.

### Read these as ranges

Across six runs of the heavy arm the arrival frame came in at 2.5 / 3.4 / 9.3 /
9.8 / 11.2 / 13.3 ms, and a second harness on a separate worktree independently
measured 9.8–13.4 ms over four runs. The spread is which frame the render side's
registration and upload land on. Two things follow: the **window**, not the
single frame, is the stable quantity; and **no single number here should be
quoted as a constant** — least of all a peak.

The frame's wall time was never the broken instrument. It has always been read by
the driver's own `performance.now()` around `step()`; what the `costs()` bug hid
was only the *breakdown*.

### What the first-visibility spike actually is

`node bench/residency/heavy.mjs` decomposes it, and the answer is not what any
of this section previously said. On the frames that hitch:

```
  render.collect.mesh                  7.10 ms
    mesh.program                       6.10 ms   ← 86%
    mesh.decompose / lod / bounds / emit   ~1.0 ms together

  render.mesh.walked                      242
  render.mesh.lodGathers                   40
  render.mesh.programAsks                 242
  render.mesh.programCompiles               1
```

**242 asks, one compile, six milliseconds.** `MeshPlugin::meshProgram` caches per
shader variant and compiles on first use, so what an arrival pays is a GLSL
compile and link for a variant nothing had needed yet. Walking 242 renderables,
gathering 40 LOD groups and decomposing every transform costs about one
millisecond between them.

The counters kill three other explanations without an argument:

| candidate | evidence | verdict |
| --- | --- | --- |
| mesh resource realization | `ResourceManager::getMesh` is `meshes_.get(handle)` — a pool lookup with no lazy creation | never measured; ruled out from source |
| LOD resolution | `lodGathers` 40 against `mesh.lod` 0.2 ms | ruled out |
| transform decomposition | `coldDecompose` is **1**, not 241 — the transform system had already done them | ruled out |

**The same cell with the variant already compiled costs 0.2 ms of collect**
(`programCompiles = 0`). Same 242 meshes, same everything else. That is the
counterfactual, and it is why the arrival frame ranged 2.8–13.3 ms across runs:
the hitch is present exactly when the arriving content needs a variant nobody
has compiled yet.

### The other spike, which is a different mechanism

Every run also shows one or two frames far from any arrival, larger than the
arrival, and they are **not** collect:

```
  f190   7.10 ms   render.finalize 6.20    (collect 0.10)
  f102  15.80 ms   render.finalize 15.30   (collect 0.00)
```

`render.finalize` is `draw_list_.finalize()` + `pool_.upload()`. These need a
cell to have been drawn — the control arm that never brings one in has no spikes
at all — but they are otherwise unrelated to the arrival. Which of the two calls
is the author is not known and is not investigated here: mixing a one-time
six-millisecond compile with a sporadic fifteen-millisecond upload is how two
mechanisms become one unsolvable problem.

**Reopening condition**: once shader-variant readiness closes, open *Render
Finalize Spike Decomposition* separately.

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

### Nothing a readied cell holds is in the world

A prepared cell's whole claim is that nothing can observe it, and an instrument
added later is exactly the thing that could quietly break it. So the walk is
asked about the world's own totals rather than about the streamer's report of
itself:

```
  scenario       prepared  resident  entities  persistent   in cells  unowned   bodies  stray
  approach              2         4       804           4        800        0      640      0
  teleport              2         1       204           4        200        0      160      0
  no-prefetch           0         4       804           4        800        0      640      0
```

`entities` must equal `persistent + in cells` exactly. An entity a preparation
spawned would be in the world's total and in no cell's row, because a prepared
cell has no `SceneManager` context to be counted under — so it would show up as
`unowned` and nowhere else. Bodies are checked the same way against the solver's
population. Both are zero, and the run that readies **nothing** is failed rather
than passed: a criterion nothing exercised has not been answered.

### An authoring rule the measurement forced

`prefetchRadius` must not exceed `unloadRadius`. The streamer knows how far a
source is and never which way it is going, so a cell that leaves the unload band
while still inside the prefetch radius is speculated about again the instant it
goes — walking away from a place fetches it a second time. Held to in
`sdk/tests/world-residency.test.ts`, both directions.


## Superseded findings

Kept rather than rewritten, because a reader who remembers the old claim needs to
find out here that it is dead — and because each was a reasonable reading of a
real measurement, which is the interesting part.

| ~~was~~ | now | what changed the answer |
| --- | --- | --- |
| ~~The arrival hitch follows publication and scales with mesh population.~~ | Publication and first visibility are distinct boundaries. The first-visibility spike is one cold shader-variant compile (~6 ms in this fixture). | The `blind` arm: publishing with the camera away costs nothing. |
| ~~`MeshPlugin::collect` scales badly on a heavy-cell arrival.~~ | Steady-state collection of the extra 241 meshes is ~0.1 ms/frame. The ~6 ms is one-time program compilation that merely happens to be called from there. | `programCompiles = 1` against `programAsks = 242`, and 6.4 → 0.1 → 0.0 ms over three frames at constant `drawn`. |
| ~~The miss path defers realization to a later frame outside the arrival window.~~ | `need f0 → publish f8 → first-visible f8`. Nothing is deferred. | Anchoring the window on the frame the renderer first ACCEPTS the renderables instead of on the residency flip. |
| ~~The later 9–15 ms spikes are the delayed arrival.~~ | They are `render.finalize`, a separate mechanism, and they carry no collect at all. | Scoping the spike frames rather than the window. |
| ~~GPU upload is not a cost this path has.~~ | GPU upload is not the author of the ARRIVAL frame. `render.finalize` — where `pool_.upload()` lives — is 9–15 ms elsewhere. | The same scoping; the first claim was true of one frame and stated of the path. |
| ~~The `costs()` probe was broken, so the old 3.5 ms arrival frames were a bad instrument's reading.~~ | The frame's wall time was always the driver's own clock around `step()`. The probe bug hid only the breakdown. | Reading what `f.ms` is actually measured by. |

## Streaming Delivery v1 — NOT frozen

What the three benches establish:

- **Residency** decides what should exist, and deciding is free (6.3 µs per 100
  cells, below the noise floor).
- **Delivery** readies content before demand, and the readying works: 100% hit
  rate on ordinary movement, 0% when speculation is disabled, and a hit's wait is
  publication alone.
- **Readiness is invisible.** Nothing a prepared cell holds is in the world, the
  renderer or the solver.
- **Cancellation** gives back what speculation acquired, receipts included.

Against the freeze conditions:

```
  ✓ fetch/preparation hidden before need
  ✓ prefetch hit/dwell measurable
  ✓ publication transaction accounted            98.6% (miss) / 104.9% (hit),
                                                 two-sided, two instruments
  ✓ first-visible frame accounted                96.0% of the arrival's excess
  ✗ a representative heavy arrival fits a frame  12.50 ms of arrival work
                                                 against 8.33 ms of headroom
```

**The last one fails, and it fails on the hit path.** Prefetch moves the cost out
of the wait and into a single frame; a heavy cell arriving on a hit costs 13.3 ms
on one frame, ~80% of a 60 Hz budget, before the game has done anything. This is a
measured budget violation on the path the feature exists to produce — which is
the agreed condition for reopening, not a hunch that something could be faster.

What that 13.3 ms is now known to be, and it is two debts rather than one:

```
  6.4 ms   publication transaction     ECS materialisation, Delivery's own
  6.1 ms   one cold shader variant     the renderer's, and only ever paid once
```

The second is not a streaming cost at all. A world that had drawn a mesh with the
same variant before pays 0.2 ms for the same arrival — which means Delivery's
share of the budget violation is the 6.4 ms, and the other half belongs to
shader-variant readiness. Both have to close before this freezes; they close
separately.

Deliberately still not built: velocity prediction, adaptive prefetch radius,
memory budget, priority scheduling. Each now has a number that would justify it.
None is the next thing to build.

### What the decomposition says NOT to do next

`spawn.components.Transform` is the largest single component write (1.3–2.2 ms)
and `spawn.migrate` deep-clones the whole document at the door (0.5 ms). Neither
is the next cut. Against a ~14 ms arrival window whose largest term is render
realization, optimising a 2 ms one is choosing the second question. Both are
recorded here and left alone.

That cut is done, and it named the mechanism: one cold shader-variant compile.
So the next one is **Shader Variant Readiness** — whether the variants
already-prefetched content will need can be made ready before first visibility,
rather than compiled at it. Not by precompiling everything: the question is
whether the exact variant key is derivable at `prepared`, at `publish`, or only
once a camera looks, because those three have different answers and only the
first is free.

**Do not optimise `MeshPlugin::collect`.** It is where the lazy compile is called
from and nothing more; the evidence clears it. Moving 6 ms from the first visible
frame into the publication transaction would not be a fix either — a hitch
relocated is still a hitch.

### Instrumentation, and how it is kept honest

The driver's probe used to call `enableStats()` on every read, swapping the maps
the frame had just filled, so the engine reported costing nothing. It also
returned only the dearest few systems — and a truncated list can only ever be a
lower bound on its own total, which makes an accounting question unanswerable by
construction. Both are fixed; no profiler lifecycle was changed.

Two rules the numbers above obey:

- **Systems are mutually exclusive; scopes nest inside them.** A domain roll-up
  adds systems only. Adding scopes to the same total double-counts and can pass
  130%.
- **A ratio's denominator must not carry fixed overhead.** Every frame costs
  ~0.1–0.2 ms outside every system (the step call, the promise turn, the driver's
  own read). Charging that to an arrival makes the ratio a measure of how *cheap*
  the window was, so what is judged is the arrival's excess against the excess
  that has names.

Every criterion here has been watched fail before being believed:

| sabotage | criterion | green → red |
| --- | --- | --- |
| 2 ms of unnamed work inside `publishRuntimeScene` | publication is explained by named work | 98.6% → 76.9% |
| component attribution switched off | no single undivided phase is most of it | → `spawn.hierarchy` at 56% |
| `costs()` truncated back to a top-N | the arrival frame is explained by its systems | 96.3% → 52.6% |

The accounting ratios are criteria on **the instrument**, not on whether Delivery
v1 deserves to freeze. A future 92% means a phase went unnamed; it does not mean
the arrival got worse.
