# Interest path decomposition

With the registry's O(E) gone — it runs on a membership journal now —
`sampleWithInterest_` is what is left. It
costs C × E, and this measures **which of its passes spends that** — production
is untouched.

## The three passes, and why two of them are the same question

Per ready connection, over every replicated entity:

| pass | what it asks | where it lives |
|---|---|---|
| **anchor** | which entities does this connection own, so its view has a place? | `radiusInterest` |
| **radius** | which candidates are near those anchors? | `radiusInterest` |
| **owner** | which owned entities did the policy cull that the server must put back? | `visibleFor_` |

`anchor` and `owner` are the same question — *what does this connection own* —
asked twice, each time by walking the whole population. The server asks it
again because the ownership invariant is its own and it does not delegate it.

## The arms

| | ownership | radius |
|---|---|---|
| **A** | scanned, twice, as shipped | full scan |
| **B** | answered from an index | full scan, unchanged |

B changes nothing else, so `B/A` is the price of not having an ownership index,
and what remains in B is the spatial problem alone.

## What it costs

`node bench/replication-interest/run.mjs`. B saw exactly what A saw, every
connection, every sample, at all three differential points.

| population | connections | A (share of one core) | B | B/A |
|---|---|---|---|---|
| 10k | 1 | 3% | 1% | 0.48 |
| 10k | 8 | 24% | 11% | 0.48 |
| 10k | 32 | 95% | 47% | 0.49 |
| 10k | 128 | **379%** | 189% | 0.50 |
| 100k | 1 | 53% | 18% | 0.33 |
| 100k | 8 | **428%** | 144% | 0.34 |
| 100k | 32 | **1700%** | 579% | 0.34 |

Entities visited per sample, which is the mechanism without this machine in it:

| | anchor | radius | owner |
|---|---|---|---|
| A @ 100k × 32 | 3,200,000 | 3,200,000 | 3,200,000 |
| B @ 100k × 32 | **32** | 3,200,000 | **32** |

## Second question: what is left, once ownership is indexed

With the owner passes gone, the radius scan is the whole cost — and it reads
each candidate's position through the builtin `Transform`, once per connection.
Two more arms separate what that costs from what the scan costs:

| | positions | walk |
|---|---|---|
| **B** | read per connection, as shipped | every candidate |
| **C0** | read once per sample, cached | every candidate |
| **C1** | read once per sample into a grid | nearby cells only |

The grid is rebuilt **every sample**, which is not a compromise — it is what
lets it support an arbitrary `position()` function. Nothing is carried between
samples, so there is no invalidation contract to get wrong. It keeps all three
of the shipped rules: a placeless entity is relevant to everyone, no positioned
anchor fails open to `'all'`, and a cell is a box while the rule is a sphere, so
the exact distance test stays.

The grid saw exactly what the full scan saw, every connection, every sample, at
all three differential points.

| population | connections | B | C0 | C1 | C0/B | C1/B |
|---|---|---|---|---|---|---|
| 10k | 8 | 115% | 19% | 16% | 0.168 | 0.143 |
| 10k | 32 | 497% | 32% | 18% | 0.064 | 0.036 |
| 100k | 8 | 1094% | 219% | 175% | 0.200 | 0.160 |
| 100k | 32 | **4623%** | 333% | **184%** | 0.072 | **0.040** |

Position reads per sample go from `connections × population` to `population`;
distance tests at 100k × 32 go from **3,200,000 to 83,267**.

**Most of the win is not the grid.** Reading each position once per sample
rather than once per connection is C0, and it alone takes 100k × 32 from 46
cores to 3.3. The grid then halves what is left. Measuring them together would
have credited spatial locality with an amortisation that has nothing to do with
space.

At 100% visible the grid still wins — 0.22 against B — because the read
amortisation survives even when locality buys nothing (C1/C0 there is 0.93).

**What an incremental index would buy is the build column, and only that.** At
100k × 32, C1 spends 1,716,864 of its 1,842,972 on rebuilding and 77,081 on
querying: the query is already 8% of a core, and the rebuild is 172%.

## What that says about the change after this one

**Half the cost at 10k, two thirds at 100k, is ownership lookup — and none of it
needs a spatial index.** An index answers it in O(owned): 3.2 million visits
become 32. That shipped first, on its own, for exactly this reason.

What remains is the radius scan, and a per-sample rebuilt grid takes 100k × 32
from 46 cores to 1.8 while keeping arbitrary `position()` support and matching
the full scan entity for entity. The build is 93% of what is left, so an
incremental index is worth designing — but it is now a question about
maintaining a structure, not about whether locality helps.

## Confirmation on the authoritative world-space path

The numbers above were taken while `defaultPosition` still read the authoring
`position`. It reads the composed `worldPosition` now, and a server composes
before it samples — so the baseline is re-taken on the path that actually ships.
Same point, 100k entities and 32 connections, 1% visible, 1% movement:

| | total | one core | ensure | build | radius | posReads | distTests |
|---|---|---|---|---|---|---|---|
| B | 51,460,116 | **5146%** | 25,597 | — | 51,384,591 | — | 3,200,000 |
| C1 | 1,976,888 | **198%** | 25,683 | 1,810,169 | 89,044 | **100,000** | **83,273** |

C1 was 184% against local positions and is 198% against composed ones: reading a
different field of the same builtin projection, as expected. The ratio holds.

Three things are asserted rather than assumed:

- **The measured path really is the composed one.** Each run builds a child five
  units right of a parent at 100 and refuses to start unless it reads 105.
- **Positions are still read once per snapshot.** `posReads` is 100,000, not
  100,000 × 32 — routing through the composed field did not turn it back into a
  per-connection read.
- **Composing is O(1) when nothing moved.** With movement at 0%, `ensure` costs
  144 µs per simulated second — 0.01% of a core — against 25,297 at 1% movement.
  A 176× gap is the epoch gate working: it neither misses an invalidation nor
  invents one.

## What this does not cover

- Arms A and B were first measured with position in a script component, which
  understated them by roughly a factor of ten: the shipped default reads the
  builtin `Transform` across the wasm boundary, and that read is most of the
  cost. Everything above uses the builtin.
- One anchor per connection. `radiusInterest` allows several, and the radius
  pass is then `candidates × anchors` — this measures the floor of that pass.
- The per-connection dirty and removal filters are timed and counted but stay
  tiny at these rates. If a provider removes the interest query, `C × (D + R)`
  is the next thing to look at — measured, not guessed.
- **The composed output has a second author, and an incremental provider is not
  production-complete until that is resolved.** `registry_batchSyncPhysics-
  Transforms` writes `worldPosition`/`worldRotation`/`worldScale` itself, marks
  the transform decomposed, and bypasses `TransformSystem` — so a provider fed by
  what the COMPOSITION says changed would silently not contain any physics-driven
  entity. Composition has a canonical author now, which is what turns that into a
  question with an answer; it is not this one. See
  `bench/transform-composition/README.md` for what the composition can hand over.
- Custom `position()` readers are why a provider cannot simply index everything:
  the server has no way to know when a caller's arbitrary function would return
  something new. That is a design constraint on any provider, not a cost measured here.
