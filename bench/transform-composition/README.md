# What it costs for a composition to say which world transforms moved

The interest path's remaining cost is rebuilding its spatial grid every sample —
181% of a core at 100k × 32, against 9% for the queries it answers. An index that
kept itself would spend the build column on the entities that actually moved
instead, and the only place that knows which those are is the composition itself.

So before designing that index: **given the composition already walks every
transform, what does it cost to also hand back the entities whose output
differs?**

## Two sets, and they are not the same size

| | what it is |
|---|---|
| **visited** | entities `TransformSystem` wrote this pass |
| **changed** | entities whose composed OUTPUT differs from what it was |

`visited` is not a useful answer. A non-static root is recomposed
unconditionally, so on a flat world the walk writes all 100,000 of them whatever
moved — a consumer told "100,000 composed" learns nothing it did not already
know. `changed` is the set an incremental index would maintain itself from.

## The output does not have one representation

A **root** publishes decomposed world TRS (`worldPosition`/`worldRotation`/
`worldScale`, `decomposed_ = true`). A **child** publishes `cachedMatrix_` and is
decomposed lazily, by whoever reads it. So the comparison is against whichever
one the entity actually publishes — and an entity arriving from the child path
with no decomposed TRS has nothing to compare, so it counts as changed.

`decomposed_` itself is **not** part of the output. A READ flips it: the pointer
accessor decomposes on the way out, so an entity anyone looked at would be
reported as having moved. The first version of this did test it, and reported
every child the bench had read — 198 of 200 — as changed in a workload where
nothing moved at all.

## The arms

| | |
|---|---|
| **A** | compose, as it ships |
| **B** | the same compose, collecting the entities whose output differs |

Both run in **one process, alternating passes** over the same world. Measured in
separate processes they differed by more than the thing being measured: B came
out *faster* than A on the tree shape, by 33%.

## What it costs

`node bench/transform-composition/run.mjs`, 100,000 entities, one compose per
pass. The tree is 1,000 roots of 99 children each.

| workload | A µs | B µs | B/A | visited | changed |
|---|---|---|---|---|---|
| flat, nothing writes | 0.3 | 1.8 | — | — | — |
| flat, 1% written, none of it moved | 638 | 847 | 1.33 | 100,000 | **0** |
| flat, 1% moved | 634 | 848 | 1.34 | 100,000 | **1,000** |
| flat, everything moved | 651 | 908 | 1.40 | 100,000 | 100,000 |
| tree, 1% moved | 1,944 | 2,085 | 1.07 | 100,000 | **1,000** |
| tree, 1% of roots moved, subtrees follow | 1,868 | 1,959 | 1.05 | 100,000 | **1,000** |
| tree, one subtree changes parent | 1,871 | 1,970 | 1.05 | 100,000 | **1** |

The `nothing writes` row is the epoch gate, not a composition: neither arm walks
anything, and B's 1.8 µs is the probe binding allocating a JS object to answer
with. It is in the table to show the gate holds, not as a cost.

**The collection is 1.3% of a core.** 213 µs on top of a compose, at 60 composes
per second, is 12,800 µs per simulated second. The grid rebuild it could replace
is 1,810,169 — **0.7% of the cost of the thing it would let us stop doing**.

Three results decide the shape of the index rather than its price:

- **1,000 of 100,000.** At 1% movement the changed set is 1% of the visited one,
  in both shapes. A grid that touched only those entries would do 1% of the
  rebuild's work.
- **Writing without moving costs nothing extra to detect.** 1% of entities
  written back unchanged produces `changed = 0` — the epoch cannot tell that case
  from real movement, and the comparison can. A tween finishing on its final
  value, a physics body asleep, an editor drag that snapped back: all free.
- **A reparent that does not move anything changes one entity.** The subtree
  keeps its world positions, so only the entity whose published representation
  flipped is in the set.

The tree pays proportionally less (1.05 against 1.34) because a child's compose
is a mat4 multiply and the comparison is 16 floats beside it, where a root's
compose is three copies.

Both arms read back the world position the probe should have composed, and the
tree's probe is a child — the path that publishes a matrix rather than a TRS. An
arm that stops composing turns four of the seven points red; the other three
never move their probe, so the check is live where movement is.

## What this does not cover

- **Physics is a second author of the composed output.** `registry_batchSync-
  PhysicsTransforms` writes the world fields itself, `decomposed_ = true`,
  without going through `TransformSystem`. A journal built on this collection
  would not contain those entities. **Not production-complete until that
  ownership is resolved** — the composition has a canonical author now, which is
  what makes it a question with an answer, but it is not this one.
- Nothing ships. `composeCollecting` has one caller and it is this bench; the
  shipped `ensureComposed` path collects nothing and pays one predictable branch
  per entity, which the A column is what says is affordable.
- The set is COUNTED here, not consumed. What an index costs to update from it —
  cell removal, reinsertion, and the ownership of entities that left the world
  entirely — is the next measurement, not this one.
- One compose per pass. A frame that runs several fixed steps composes several
  times, and the changed sets would have to be unioned or consumed per step.
