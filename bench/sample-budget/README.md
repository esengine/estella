# What a replication sample is actually spent on

> Part of a closed phase — the rulings and their reopen conditions are in
> [`bench/REPLICATION_SCALING.md`](../REPLICATION_SCALING.md).

Seven population scans came out of this path — registry, dirty discovery,
ownership, position reads, grid rebuild, row routing, idle visibility. Guessing
the next wall from the source after that is how you start optimising second-order
terms. So this stops guessing and takes a budget instead.

```
node bench/sample-budget/arm.mjs --scenario mixed
```

100k entities, 32 connections, ~1% visible, the shipped `radiusInterestProvider`,
the real `ReplicationServer` sampling every fixed tick. Every phase is timed
where it happens; `other` is `total` minus the sum of the leaves, so **a budget
that does not close has not been decomposed**. These close to within 0.5%.

## The four workloads

| | what moves |
|---|---|
| **still** | nothing — the N3e baseline. A health check, not a subject. |
| **movement** | 1% of the population, anchors stationary |
| **anchors** | that, and every connection's OWN anchor as well |
| **mixed** | that, plus 1% dirty fields and 0.1% component removals |

**`anchors` is mandatory, not a variant.** A connection's owned anchor is one of
its query's inputs, so it invalidates that connection by itself. Any claim that a
movement workload got cheaper has to survive it or it is a benchmark-only cache
(see `bench/interest-regional/`).

## The budget, µs per sample

| phase | still | movement | anchors | mixed |
|---|---|---|---|---|
| composition | 0 | 914 | 919 | 873 |
| registry | 0 | 2 | 3 | 2 |
| owner index | 0 | 1 | 1 | 1 |
| interest prepare | 3 | 802 | 871 | 830 |
| **visibility query** | 0 | **3,849** | 3,972 | 3,768 |
| visibility diff | 0 | 895 | 1,342 | 1,235 |
| **dirty discovery** | 1 | **4,225** | 4,360 | **7,521** |
| routing | 2 | 185 | 213 | 412 |
| **spawn payload** | 0 | 136 | **9,940** | **9,608** |
| frame encode | 0 | 63 | 89 | 263 |
| control send | 2 | 61 | 1,611 | 1,516 |
| transport send | 0 | 44 | 35 | 33 |
| ack + reader floors | 2 | 6 | 10 | 12 |
| other | 8 | 32 | 112 | 101 |
| **sample total** | **19** | **11,216** | **23,477** | **26,176** |
| accounted | 58% | **99.7%** | **99.5%** | **99.6%** |
| enters / leaves per sample | 0 / 0 | 6 / 6 | 675 / 676 | 675 / 676 |

`still` accounts for only 58% because the sample is 19 µs and the instrument
costs about 8 of them. At every workload that matters the instrument is under
0.1%. Runs reproduce within 5%.

## Three things this says, and one it refuses

### Encoding and transport are 1.5% of the sample, not the remainder

`frame encode` + `transport send` is 107 µs of 11,216 at `movement` and 296 µs of
26,176 at `mixed`. **The server has not become a thing that pays for network
work.** It is still overwhelmingly a thing that pays to find out what happened —
the hypothesis that the leftover cost would track actual wire entries is refuted,
and serializer or frame-batching work would be optimising 1% of the sample.

### `dirty discovery` is still O(population) whenever anything at all changed

4,225 µs at `movement`, where **1,000 entities of 100,000 moved**. `collectDirty_`
has an O(1) gate — `anyChangedSince` — and it is exactly why `still` is 1 µs. But
once any entity of a component has changed, the gate opens and the pass walks the
whole of `known_` asking `isChangedSince` per entity, per replicated component.

The enumeration it wants already exists and is already used one function earlier:
`refreshOwnerIndex_` reads `getWrittenEntitiesSince(Replicated, floor)` off the
write journal to get exactly the entities written since its floor. Dirty
discovery scans instead.

### `spawn payload` dominates the moment views actually churn

Nine point nine milliseconds — **42% of the `anchors` sample** — to serialize 675
entering entities, about **14.7 µs each**. That is what player movement costs: an
anchor shifting one unit sweeps entities across the edge of a 17.8-unit radius, and
each one that enters a view is serialized in full.

`serializeEntityComponents` writes EVERY non-structural component on the entity,
not the replicated ones the wire table declares — a component list read across the
wasm boundary, a `tryGet` per component, a clone for script components and a codec
lookup, all to produce the fields the delta path already knows how to name.

### What it refuses to say

Whether either is worth fixing. This is a budget, not a plan: `dirty discovery` is
the biggest item at realistic movement and `spawn payload` the biggest when views
churn, and which of those a game is actually shaped like decides the order.

## Acted on: dirty discovery now takes the cheaper projection

The scan is gone as the only option. A replicated component belongs to the whole
world, so the write journal lists everything written to it — including entities
this server does not replicate — while the scan asks each known entity and costs
the population however few moved. Neither dominates, so the pass picks per
sample, on the same `U >= S` shape the router uses: buffered rows bound what the
journal would return, in O(1), so neither side is materialized to choose.

Measured **ABA-interleaved**, three rounds, because the machine drifted 20% over
the session and a straight before/after had already produced one 45,814 µs
reading of code that runs at 22,627:

| | dirty discovery | sample total |
|---|---|---|
| movement | 4,772 → **1,828** (2.6x) | 12,269 → **8,674** (−29%) |
| mixed | 8,028 → **2,866** (2.8x) | 27,955 → **22,627** (−19%) |

Every interleaved pair had the new side lower. What is left in the phase is the
work rather than the search: a `tryGet` and a field-by-field compare against the
shadow for each candidate that really did change.

`bench/sample-budget` reports `journalReads` and `populationScans` so a claim
about either projection can say which one it got.

## N6: the budget re-taken after the spawn split

Same instrumentation, same workloads, three interleaved rounds. Medians; every
figure a percentage of that column's total.

| phase | still | movement | anchors | mixed |
|---|---|---|---|---|
| **visibility query** | 0 | **3,772 · 43%** | **4,435 · 31%** | **4,533 · 31%** |
| **dirty discovery** | 1 | 1,913 · 22% | 2,165 · 15% | 3,049 · 21% |
| **spawn payload** | 0 | 50 · 1% | 2,622 · 18% | 2,372 · 16% |
| visibility diff | 0 | 875 · 10% | 1,392 · 10% | 1,361 · 9% |
| control send | 2 | 61 · 1% | 1,207 · 8% | 1,061 · 7% |
| composition | 1 | 895 · 10% | 986 · 7% | 900 · 6% |
| interest prepare | 4 | 770 · 9% | 972 · 7% | 935 · 6% |
| routing | 2 | 165 · 2% | 182 · 1% | 502 · 3% |
| frame encode | 0 | 71 · 1% | 104 · 1% | 281 · 2% |
| transport send | 0 | 55 · 1% | 43 · 0% | 41 · 0% |
| other | 11 | 31 · 0% | 121 · 1% | 155 · 1% |
| **total** | **25** | **8,714** | **14,249** | **14,791** |
| accounted | 53% | **99.6%** | **99.2%** | **99.2%** |

`still` is 25 µs — the idle fast path survived protocol v4, and it accounts for
only half of itself because the instrument is 11 of those microseconds.

### The work, beside the time

| per sample | movement | anchors | mixed |
|---|---|---|---|
| visibility recomputes | 32 | 32 | 32 |
| dirty candidates examined | **1,000** | 1,032 | 2,132 |
| journal reads / population scans | 3 / 0 | 3 / 0 | 3 / 0 |
| enters / leaves | 6 / 7 | 682 / 686 | 682 / 686 |
| spawn payloads built | 6 | 682 | 682 |
| delta rows sent | 175 | 175 | 467 |
| control bytes | 2,262 | **178,683** | 178,703 |
| binary bytes | 4,227 | 4,222 | 8,315 |

**Dirty discovery examines exactly the entities that changed** — 1,000 candidates
for 1,000 movers, and the journal wins the projection choice every time (3 reads,
0 scans). That phase is now proportional to what happened.

### First place is the query, and it is not overhead

Timed at the provider seam (`--seam`, off by default so the table above is not
measured through a wrapper that exists to take it apart), `visibility query`
splits:

| | provider computes | host copies |
|---|---|---|
| movement | 3,432 (**94%**) | 216 (6%) |
| anchors | 4,405 (**92%**) | 399 (8%) |
| mixed | 4,563 (**95%**) | 260 (5%) |

The host's share — copying the answer into a set it owns and forcing owned
entities into it — is 5–8%. The rest is the grid walk and the sphere test over
about 925 entities per connection, at **0.149 µs per (connection × visible
entity)**. And the number of queries is 32 whatever is done to them: an owned
anchor is one of its own query's inputs, which `bench/interest-regional/`
settled. So neither the count nor the unit is carrying obvious waste.

### The spawn, split three ways

| | where it is |
|---|---|
| ghost construction | **not on the server at all** — protocol v4 moved it to the client's archetype |
| baseline serialization | `spawn payload`, 2,622 µs for 682 entities = **3.8 µs each** (14.7 before) |
| control-message overhead | `control send` 1,207 µs, which the transport's own clock splits 421 encode / 786 transport |

**So N5c stays closed on CPU.** Its re-open condition was spawn encoding
becoming top-1/top-2 *with baseline encode the bulk of it*; encode is 421 µs of
a 3,829 µs spawn cost — 11%. Object construction and transport are the rest.

**But note where the bytes are.** The control plane carries 178 KB a sample
against the binary plane's 4–8 KB: JSON spawn batches outweigh the delta frames
by twenty to forty times. That is 10 MB/s at this churn rate, and it is not
visible in the CPU budget at all. If `FrameWriter`-shaped baselines are ever
worth doing, **bandwidth is the argument, not microseconds** — which is a
different re-open condition from the one this bench was built to test.

### The judgement

Encode and transport are 1–2% of the sample. Every large phase is now
proportional to something that actually happened: entities that moved, views
that had to be re-proved because their own anchor moved, entities that genuinely
entered a view. `other` is under 1%.

**The remaining cost is mostly necessary work, and this line should stop here.**
What is left is not scanning to establish that nothing happened — that was the
whole shape of the first seven cuts, and it is gone.

## What this does not cover

- One anchor per connection, a uniform grid world, and clients connected but not
  ticked. What is timed is the server's own `sample`.
- `control send` is JSON encoding AND transport — `NetChannel` does both behind
  one call. Only the delta frame is split, which is where the split is worth
  having.
- `spawn payload` is serialization only. It is timed before the send that carries
  it, because inside it the two would be counted twice — which is how the first
  version of this table came out at 142% accounted.
- The N6 table is medians of three interleaved rounds. A machine that drifts 20%
  across a session will otherwise tell whichever story the run order suggests.
- Phase times are means over the window; the total is reported as a mean and a
  minimum. A budget cannot be built from minima, since the phases of one sample
  are not the phases of another.
