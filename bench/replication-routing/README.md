# The interest send path, once visibility is local

The provider took the spatial question from 5504% of a core to 18%. What is left
in `sampleWithInterest_` is per connection, and two of its passes walk a GLOBAL
list every time:

```
for each connection:
    removals.filter((r) => visible.has(r.entity) && …)     // O(C × R)
    for (const d of dirty) if (!visible.has(d.entity)) …   // O(C × D)
```

Neither knows that a connection sees 1% of the world. This measures what they
VISIT against what survives them — and, first, whether they are the wall at all.

Decomposition, not optimisation: this drives the real `ReplicationServer` with
32 real connections and changes nothing.

## How it is measured

`node bench/replication-routing/run.mjs`. 100,000 entities, 32 connections, the
shipped `radiusInterestProvider` at 1% visible, and the server sampling every
fixed tick — 60 a second, not 20: `ReplicationSampleSystem` runs in
FixedPostUpdate, so C × D is paid at the simulation rate.

The two axes are swept apart rather than crossed, because the question is which
of them is a wall. Rates are what the bench WRITES; the row counts are what the
server actually has to route, which is not the same number — moving an entity
dirties it, and so does giving a removed component back.

Times are the **fastest** measured sample, not the mean. A neighbouring process
only ever makes a sample slower, and the fastest reproduces to the microsecond
between runs where the mean moves by 5%. Two arms run back to back once differed
by 40% on the mean and not at all on the minimum.

## First: the two filters are not the wall

| workload | µs/sample | one core | over the floor |
|---|---|---|---|
| **nothing moves at all** | 7,690 | 46% | — |
| floor: 1% movement, nothing else | 14,477 | 87% | — |
| dirty 0.1% | 17,524 | 105% | +3,047 |
| **dirty 1%** | 19,343 | 116% | +4,866 |
| dirty 10% | 33,756 | 203% | +19,279 |
| dirty 100% | 90,828 | 545% | +76,351 |
| removals 0.1% | 17,763 | 107% | +3,285 |
| removals 1% | 18,007 | 108% | +3,530 |
| removals 10% | 21,587 | 130% | +7,110 |
| **mixed — 1% dirty, 0.1% removed** | 19,563 | 117% | +5,086 |

At the rates a game actually runs at, **three quarters of the sample is there
before a single extra dirty row exists**. Routing the mixed workload's rows adds
26%. The filters only take over past 10% dirty, where they add 19 ms.

## But what they visit is almost all waste

| workload | D rows | C × D visits | actually sent | ratio |
|---|---|---|---|---|
| 1% movement only | 1,000 | 32,000 | 270 | **119:1** |
| dirty 1% | 1,991 | 63,712 | 567 | **112:1** |
| dirty 10% | 10,902 | 348,853 | 3,201 | 109:1 |
| dirty 100% | 100,000 | 3,200,000 | 29,547 | 108:1 |

| workload | R rows | C × R visits | actually sent | ratio |
|---|---|---|---|---|
| removals 0.1% | 100 | 3,200 | 31 | **102:1** |
| removals 1% | 1,000 | 32,000 | 292 | 110:1 |
| removals 10% | 10,000 | 320,000 | 2,933 | 109:1 |

The ratio is the coverage: 32 connections seeing 923 entities each cover about a
third of a hundred thousand, and a row is asked about 32 times to be sent 0.3
times. It barely moves with the rate, which is what makes it structural rather
than a tuning question.

## What a router would need, and what it would cost to keep

| | spread connections | packed together |
|---|---|---|
| V per connection | 923 | 490 |
| C × V | 29,547 | 15,689 |
| viewers per visible entity | **1.00** | **8.10** |
| enters per sample, all connections | 7 | 3 |
| leaves per sample, all connections | 5 | 4 |

Both candidates are bounded, and by different things:

- **Pull by visible** — for each connection, ask its ~923 visible entities
  whether they are dirty. `O(C × V)` = 29,547, whatever D is. It adds no new
  order: the enter/leave diff is already O(C × V).
- **Push by reverse interest** — for each dirty row, tell the connections that
  can see it. `O(D × viewers)` = 2,089 at the mixed point, 32× less than C × D
  and 14× less than pull.

So the crossover is `D × viewers` against `C × V`: push while fewer than ~29,000
rows are dirty a sample, pull past that. At the mixed workload push wins by 14×;
at 100% dirty pull wins by 3×.

**Maintaining the reverse index is not the tax it looks like.** Twelve enter and
leave events per sample across all 32 connections — the interest sets barely move
once the world is steady, which is the same fact that makes the enter/leave DIFF
(29,547 comparisons to find 12 events) look the way it does.

## What this does not cover

- **Encoding is inside the totals and not separated.** It is proportional to what
  is actually SENT — 598 entries at the mixed point — so it is the floor a
  perfect router leaves behind, not part of the wall. Separating it needs the
  frame writer, which is not on the SDK's entry.
- **The still floor is not explained here.** 7,690 µs with nothing moving is
  about 0.14 µs per (connection × visible entity) plus a constant that does not
  follow the population — a quarter of the entities at the same C × V costs
  3,675. Whatever that constant is, it is not C × D and not C × R.
- One anchor per connection, and a uniform grid world. `viewers per entity` is
  the number the push/pull choice turns on, and it is a property of how players
  are arranged: 1.00 spread across the map, 8.10 packed into a thousandth of it.
- Client apps are connected but not ticked during measurement. What is timed is
  the server's own sample.
