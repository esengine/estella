# Does one entity moving have to invalidate every connection?

N3e made the sample in which NOTHING moved free — 3,863 µs to 17 at 100k × 32.
What it did not touch is the sample in which something moved *somewhere else*:
there is one spatial generation, so a single write re-proves all C views.

This asks what it would cost to invalidate only the connections whose answer
could have changed — and, first, whether there is anything there to win.

```
node bench/interest-regional/probe.mjs --scenario near
```

## Three shapes over one truth

Every arm decides only **whether** to call `prepared.query`, never what it
answers. The truth is the shipped `radiusInterestProvider`.

| | how it decides |
|---|---|
| **G** | one global generation — what ships. Anything moves, everyone re-queries. |
| **A** | fingerprint the cells this connection's radius covers; unchanged ⇒ skip |
| **B** | reverse cell → connections; a mutation marks its watchers, the query reads one flag |

**A's token is over the whole support region, not the anchor's cell.** A radius
answer depends on every bucket it can reach: an entity moving in a neighbouring
cell changes it while the anchor's own cell stands still. The keys are hashed as
well as the revisions, so an anchor that crossed into a new cell cannot keep a
token minted for the cells it left.

## The answer: the ceiling is the grid, not the token

`cell = radius` (the provider's own), so at 100k entities and 1% visibility the
world is about 350 cells and a footprint is 9 of them. **1% movement is 1,000
movers — about three per cell.**

| scenario | distinct cells touched / world | G recomputes | **A recomputes** | G µs | A µs | B µs | A tax | B tax |
|---|---|---|---|---|---|---|---|---|
| scattered — 1% moves uniformly | **434 / 374** | 32 | **32.0** | 2,336 | 2,392 | 2,429 | 70 | 180 |
| clustered connections | 434 / 374 | 32 | **32.0** | 1,563 | 1,585 | 1,683 | 47 | 143 |
| every anchor moves | **43 / 35** | 32 | **32.0** | 2,327 | 2,371 | 2,480 | 57 | 146 |
| movement far from anchors | 40 / 32 | 32 | 31.0 | 2,544 | 2,475 | 2,533 | 70 | 152 |
| crossing a cell boundary | 460 / 1008 | 32 | **10.2** | 3,116 | 864 | 911 | 79 | 100 |
| movement next to one anchor | **26 / 342** | 32 | **5.4** | 3,024 | **429** | 411 | 67 | 46 |

- **Uniform movement touches the whole grid, so no token over that grid can be
  quiet.** 434 distinct cells against a 374-cell world: not "most of it", all of
  it and then the ones that came and went. This is a property of the cell size,
  not of how the token is computed, and the grid is frozen.
- **A connection's own anchor moving invalidates that connection**, always and
  correctly. So in a game where every player moves every tick, recomputes are
  `C` whatever the scheme — the floor is not reachable from here.
- **The win is real where movement is concentrated**: 26 cells of 342 touched
  gives 5.4 of 32 connections re-proved, and 3,024 µs → 429. That is the shape
  of NPC or physics traffic in a region nobody is standing in.

## B is strictly dominated

**A and B produce the identical recompute count in every scenario** — they are
the same predicate computed two ways. B then pays 2–3× the maintenance for it
(143–180 µs against 47–79), because it re-registers footprints and walks
watchers where A hashes 27 map reads at query time.

So the reverse cell → connection index is not worth maintaining. The question
this probe existed to answer — *is scanning a few dozen cell revisions already
close enough to free* — comes out **yes**: A's tax is 47–79 µs per sample for
32 connections × 27 cells, about **2 µs per connection against a 73 µs query**.

## What this means for shipping it

A costs ~3% of a query and can save 86% of one. It never loses much and
sometimes wins sevenfold — but the scenarios a 32-player game actually runs
(everyone moves) are exactly the ones where it wins nothing.

**So this is not the next cut on its own.** It is worth doing when there is a
workload with many connections and localized movement — an MMO shard, or a game
whose NPCs outnumber its players — and the shape to build then is A.

## The two ways this goes wrong, kept apart

The probe audits every arm against an independent full rebuild on the last
samples, and **refuses to report a single number if any arm's set differs**
(exit 1). That separates the two failures the counts alone would confuse:

| sabotage | what reddens |
|---|---|
| the regional token written as the global generation | `near`: A recomputes 5.4 → **32**. The audit stays green — nothing went stale, the optimisation just stopped working. |
| the footprint narrowed to the anchor's own cell | the audit: `arm A, connection 2, sample 25: missing 4200931`, exit 1. Counts look *better*; the answer is wrong. |

## What this does not cover

- One anchor per connection and a uniform grid world. `distinct cells touched`
  is the number everything turns on, and it is a property of how players and
  movement are arranged.
- The arms are timed in a **rotating order**. Fixed at G,A,B this first reported
  A and B 40% faster than G on samples where all three recomputed the identical
  32 views — the last arm was reading caches the first two warmed.
- The probe maintains its own cell revisions from the mutations it makes; a
  production version would maintain them where the provider already consumes the
  composition delta. What is measured is the decision, not that plumbing.
