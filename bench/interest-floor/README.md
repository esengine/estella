# What a sample costs when nothing has happened

With no dirty row and no removal, a stationary server spends **3,573 µs a sample
— 21% of one core** at 100,000 entities and 32 connections. Nothing moved,
nothing entered anyone's view, nothing left it, and nothing was sent.

> That figure was 7,334 when this was first written, because the bench it came
> from had one connection owning nothing, failing open to `'all'`, and being
> handed the whole population every sample. Nothing in THIS probe was affected —
> it drives the provider directly with its own consistent keys — but the share it
> was said to be of has changed: the visibility pass is not 47% of a stationary
> sample, it is nearly all of one.

`node bench/interest-floor/probe.mjs`. Nothing here is installed on a server;
the counterfactual arms remove one layer at a time from a transcription of the
server's visibility pass.

## Where it goes

The visibility pass — ask the provider, copy the answer, walk it for arrivals,
walk the previous view for departures — is **3,439 µs**, which is essentially the
whole stationary sample.

| | µs | |
|---|---|---|
| prepare | 16 | nothing is stale, so the composition and the index both no-op |
| **query** | **2,825** | 32 connections × the grid walk |
| materialize | 128 | the server's own copy of each answer |
| enter scan | 377 | |
| leave scan | 330 | |
| empty route | 3 | with no debt at all |

| counted, per sample | |
|---|---|
| visible entries | 29,584 |
| set insertions | 29,616 |
| enter membership tests | 29,584 |
| leave membership tests | 29,584 |
| **actual enters** | **0** |
| **actual leaves** | **0** |

Twenty-nine thousand membership tests to establish that nothing changed.

## The two counterfactuals

| arm | what it does | µs |
|---|---|---|
| **A** | as it is: ask, copy, scan for arrivals, scan for departures | 3,439 |
| **B** | the same, with the spatial query already answered | 615 |
| **C** | told the view has not changed: no copy and no scan | **1.5** |

- `A − B` = **2,824 µs — the query.**
- `B − C` = **614 µs — the copy and the two scans.**

**The query is 82% of it, and the copy and diff are 18%.** That is the opposite
of what the shape of the counts suggests: 29,584 comparisons finding twelve
events looks like the expensive half, and it is the cheap one. Copying is the
cheapest part of the cheap half — V8 clones a Set far faster than it answers
29,584 `has` calls against one.

The split does not soften with movement, it sharpens:

| | prepare | query | copy + scans |
|---|---|---|---|
| stationary | 16 | 2,825 | 835 |
| 0.1% moving | — | 3,972 (with prepare) | 674 |
| 1% moving | 1,798 | 3,773 | 900 |

## What that says about the change after this one

A connection being able to hear **"your view has not changed"** costs 1.5 µs
against 3,439. But the number that makes it worth building is not the 614 µs of
copy and diff the server would skip — it is the **2,824 µs of query that the
PROVIDER would not have to run**. A persistent provider already knows whether
anything it indexes moved; answering from that is what avoids the grid walk, and
handing the server an `'unchanged'` it can only use after the query has happened
would leave 82% of the floor on the table.

So the contract to design is one the provider consults BEFORE walking cells, not
one the server consumes after. Nothing is designed here — this measures.

## And the rest of the sample

There is almost none. `bench/idle-maintenance` measures what a sample does
BESIDES visibility when nothing has happened — reconciling the registry against
its topology journal, gating the change journal, reading empty removal windows,
giving three kinds of reader a new floor — and it is **about 1.3 µs**. Timed
inside the real server: reconcile 0.4, owner refresh 0.1, dirty collection 0.8.

The 3,895 µs of "idle maintenance" this section used to claim was the same
`'all'` connection, counted a second time.

## What this does not cover

- A transcription of the visibility pass, not the server running it. The
  absolute figure it is measured against — 7,334 µs — comes from the real server
  in `bench/replication-routing`.
- The per-segment timers are inside the instrumented arm, so they read high: the
  segments sum to 835 µs where the uninstrumented `B − C` says 614. The
  counterfactual differences are the trustworthy numbers; the segments say how
  the difference splits.
- One anchor per connection, connections spread across the map, a uniform grid.
  `query` is 32 grid walks; a world where every connection stands in the same
  place would walk fewer distinct cells.
