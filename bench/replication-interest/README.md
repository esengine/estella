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
maintaining a structure, not about whether locality helps. That question is the
third one below, and the answer is 15% of a core.

## Third question: what the grid costs when it is KEPT

The build column is the whole remaining cost, and it is paid every sample
whatever moved. `TransformSystem` knows exactly which entities' composed output
differs — costed in `bench/transform-composition` at 1.3% of a core — so a fourth
arm keeps its grid and moves only those between cells.

| | positions | grid |
|---|---|---|
| **C1** | read once per sample, all of them | rebuilt every sample |
| **D1** | read for the entities that moved | kept; those entities re-celled |

D1's query side is byte for byte C1's — the same cell arrays, the same cache map,
the same `visibleForC1` — so what the two differ by is the build column alone.

| population | connections | C1 | D1 | D1 build | C1 build | D1/B |
|---|---|---|---|---|---|---|
| 10k | 8 | 19% | **1%** | 1,852 | 177,024 | 0.007 |
| 10k | 32 | 19% | **2%** | 1,638 | 170,694 | 0.004 |
| 100k | 8 | 226% | **12%** | 22,026 | 2,179,859 | 0.009 |
| 100k | 32 | 200% | **15%** | 17,034 | 1,834,928 | 0.003 |

Position reads per sample go from 100,000 to **668**. The rest of the mechanism
is unchanged: 864 cells, 83,267 spatial candidates, 83,267 distance tests — the
same numbers C1 produces.

**At 100k × 32 the interest path goes from 5,559% of a core to 15%.** The grid
cost 200% while it was rebuilt and costs 15% while it is kept, and the build
inside that falls by 108×.

Seeding is one full build — 105 ms at 100k — paid once at startup, against the 92
ms C1 pays every sample.

Three properties are asserted rather than assumed:

- **D1 saw exactly what the full scan saw**, every connection, every sample, at
  three points.
- **The kept grid holds what a rebuilt one would.** Compared against a fresh
  build at the end of every point: zero drifted positions, zero drifted cells,
  nothing missing, nothing extra. This is the check that matters, because a stale
  cell only reaches the visible-set differential if it changes somebody's view —
  and at 1% visible, most of the world is nobody's. Stop updating the coordinate
  cache and 74 positions drift; stop re-celling and 74 cells do.
- **Every entity the composition reported was one the grid knew about.**

### What ships, measured rather than inferred

D1 is this file's reproduction of the idea. **P is `radiusInterestProvider`
itself**, driven the way the server drives it — prepared once per sample with the
membership delta, queried per connection, with the server's owned-forcing applied
where the server applies it. Only its position reads are counted, because the
rest happens inside the SDK.

| population | connections | C1 | D1 | **P** |
|---|---|---|---|---|
| 10k | 8 | 20% | 1% | **1%** |
| 10k | 32 | 20% | 2% | **2%** |
| 100k | 8 | 240% | 9% | **8%** |
| 100k | 32 | 195% | 17% | **18%** |

Position reads per sample: **68** at 10k and **668** at 100k, the same numbers the
prototype produces, and **0** with nothing moving. P is in the differential too:
it saw exactly what the full scan saw, every connection, every sample.

Running it found that the provider was not reachable. `radiusInterestProvider`
was exported from the replication barrel and never from the SDK's entry point, so
no game could install the thing this whole line of work was for.

### What a kept grid still needs, and this does not have

**The changed set is a value-change journal, not a membership journal.** Measured,
not reasoned: a new entity spawned at the origin is not reported, because its
composed output equals what its fields already held; a despawned entity is not
reported at all; a new entity anywhere else is reported only incidentally,
because its value differs from the default. The shipped provider takes membership
from the server's enter/leave and movement from here, and a third feed for
entities that LOST the component the cached position came from. This workload
spawns and despawns nothing after startup, so none of that is measured here —
`sdk/tests/replication-interest-persistent.test.ts` is where it is.

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
- ~~The composed output has a second author.~~ **Closed.** The 2D physics
  writeback wrote the world fields itself and bypassed `TransformSystem`, so a
  provider fed by the composed delta would not have contained one physics-driven
  entity. It writes the local input now and says the composition is stale; a
  parented body's solver pose is solved back through its parent. This workload
  runs no physics, so what it measures is unchanged.
- Custom `position()` readers are why a provider cannot simply index everything:
  the server has no way to know when a caller's arbitrary function would return
  something new. That is a design constraint on any provider, not a cost measured here.
