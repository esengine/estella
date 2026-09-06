# LODGroup at scale — what it costs and what it buys

`node bench/lod/run.mjs` drives two scenes that differ in one component. Both hold
the same props on the same lattice under the same camera; `lod-field` gives every
prop a `LODGroup`, `lod-field-flat` gives it none and so draws level 0 always.
Every number below comes from the engine's own counters and scope timers, read out
of the frames the SDK's profiler recorded — the same frame path the pixel gates use.

The camera looks along the lattice, so the props recede: near ones are big on
screen, far ones are specks. That is the shape LOD exists for, and it is also why
the level counts are lopsided — most of a receding field is far away.

## Measured 2026-09-05 (M-series Mac, WebGL2, 512x512, median of 60 frames)

The counts and the triangle totals are exact and reproduce run to run; `gpuMs` is
a measurement and moves a few percent between runs (the 10k LODGroup row read
0.256, 0.269 and 0.285 over three).

```
props       scene  selections  lod0  lod1  lod2  lodCulled  drawn  culled  triangles  draws  collectMs  gpuMs
 1024    LODGroup         874    10    22   458        384    490     534       4248      3      0.100  0.116
 1024  alwaysLOD0           0     0     0     0          0    874     150     195776      1      0.100  0.505
10000    LODGroup        8540   102   248  4390       3800   4740    5260      42392     21      0.900  0.285
10000  alwaysLOD0           0     0     0     0          0   8540    1460    1912960      1      0.600  3.595
```

`selections` is how many props reached LOD selection — the rest the frustum had
already rejected, which is why the cull runs first. `culled` counts both kinds, so
the LOD rows carry the frustum's rejections plus the ones LOD threw away.

## What it says

- **Triangles fall 46x at 1k and 45x at 10k.** Most of a receding field is far, and
  far is where the 4-triangle stand-in is indistinguishable from the 224-triangle one.
- **GPU time falls about 4x at 1k and 13x at 10k** (0.505 -> 0.116 ms, 3.5 -> 0.27 ms).
  The gap widens with count, which is the point: this is the number that decides
  whether a field of ten thousand props is shippable.
- **Selection costs 0.2-0.3 ms of CPU per ten thousand props** (`render.collect`
  0.6-0.7 -> 0.9 ms). At a thousand it is under the timer's resolution.
- **Instancing survives.** 1024 props at three levels reach the GPU as 3 draws, and
  10000 at three levels as 21 — choosing a level changes which geometry a draw names
  and nothing else, so props sharing a level still fold into one instanced call. The
  21 is the depth sort interleaving two levels where their distance bands meet; it is
  the cost of ordering opaque geometry front-to-back, not of LOD.
- **The trade is CPU for GPU, and the exchange rate is good**: about +0.25 ms of
  collect buys back 3.3 ms of GPU at ten thousand props.

## Reproducing

```
node bench/lod/run.mjs                 # 1k and 10k, both scenes
node bench/lod/run.mjs --counts 10000  # one size
node bench/lod/run.mjs --frames 120    # a longer median
```

The lattice keeps ONE footprint across the sizes (`LAYOUTS` in `run.mjs`), so ten
times the props is ten times as dense rather than a field ten times as wide — the
camera frames the same world either way.
