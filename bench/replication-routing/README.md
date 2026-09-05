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

> **These numbers were re-measured.** The first run of this bench keyed each
> connection's anchor by the loop counter while connection ids start at one, so
> the last connection owned nothing, failed open to `'all'`, and was handed a
> hundred-thousand-entry Set every sample. Every wall time was that Set. The
> counts, which came from an oracle with its own consistent keys, were never
> affected. `arm.mjs` now compares the server's own `viewerLinks` against the
> oracle's total each census and refuses to report if they disagree.

## First: the two filters are not the wall

| workload | µs/sample | one core | over the floor |
|---|---|---|---|
| **nothing moves at all** | 3,573 | 21% | — |
| floor: 1% movement, nothing else | 8,751 | 53% | — |
| dirty 0.1% | 11,234 | 67% | +2,483 |
| **dirty 1%** | 11,662 | 70% | +2,910 |
| dirty 10% | 19,273 | 116% | +10,522 |
| dirty 100% | 42,463 | 255% | +33,712 |
| removals 0.1% | 11,225 | 67% | +2,473 |
| removals 1% | 12,055 | 72% | +3,303 |
| removals 10% | 15,697 | 94% | +6,945 |
| **mixed — 1% dirty, 0.1% removed** | 12,234 | 73% | +3,483 |

At the rates a game actually runs at, **more than two thirds of the sample is
there before a single extra dirty row exists**. Routing the mixed workload's rows
adds 28%. The filters only take over past 10% dirty.

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

## N3b: routing the debt, four ways

`node bench/replication-routing/probe.mjs`. The same five workloads, but only the
ROUTING: all four arms consume one canonical truth — this sample's dirty rows,
its removals, and the shipped provider's real visibility — and must produce the
same plan before any time is believed.

| | how it gets a row to a connection |
|---|---|
| **A** | every connection walks every row — what ships |
| **P** | each affected ENTITY is handed to the connections that can see it |
| **L** | each connection asks its own view what happened to it |
| **H** | whichever of the two is smaller, from this sample's own counts |

Debt is merged per entity first: an entity with two dirty components and a
removal is one reverse lookup on the push side and one map probe on the pull
side, not three. The wire still carries removals before the delta.

The reverse index is the server's, not the provider's — `viewersByEntity` is the
projection of `conn.interest`, maintained from the enters and leaves the
visibility pass already produces.

### Visits

| workload | A | P | L | H |
|---|---|---|---|---|
| scattered mixed | 66,920 | **2,710** | 29,566 | 2,710 |
| clustered mixed | 66,920 | **2,385** | 15,683 | 2,385 |
| everything dirty | 3,200,000 | 129,509 | **29,509** | 29,509 |
| removals 10% | 352,000 | **14,078** | 29,481 | 14,078 |
| movement only | 32,000 | **1,243** | 29,444 | 1,243 |

### Microseconds, and what counts as a difference

`L2` is `L` again, by the same call from a second site. Two arms running
identical code came out **31% apart**, so nothing closer than that is a
difference this harness can see — and every conclusion below is outside it.

| workload | A | P | L | L2 | **H** | H picked |
|---|---|---|---|---|---|---|
| scattered mixed | 783.5 | 110.7 | 352.1 | 367.2 | **85.1** | push |
| clustered mixed | 720.8 | 43.5 | 103.4 | 94.8 | **42.2** | push |
| everything dirty | 37,434.2 | 6,353.1 | 3,872.4 | 2,966.1 | **3,090.7** | pull |
| removals 10% | 4,191.5 | 474.3 | 701.8 | 692.6 | **471.4** | push |
| movement only | 382.2 | 37.6 | 397.3 | 399.2 | **34.2** | push |

- **A costs 9 to 12 times the adaptive router at every point.**
- **The choice is worth making.** Push beats pull by 3.2x at the mixed workload;
  pull beats push by 1.6x with everything dirty. Both are outside the floor.
- **H picked the right side every sample of every point** — never the mixed
  workload by pull, never everything-dirty by push — and lands within the noise
  floor of the better arm each time.

### The chooser, and the one thing it must not do

```
U = affected entities          F = their exact viewer fanout
S = total interest membership          push while U + F < S
```

No rate, no average, no threshold. The 29,000 that N3a's counts crossed at is an
observation about one workload and does not belong in the engine.

But measuring `F` costs `U` reverse lookups, which is push's own dominant term —
so an exact chooser that always measures it pays to decide **not** to push. That
is not hypothetical: the first version ran 4x slower than pull with everything
dirty, having spent 20,000 lookups to conclude it should not do 20,000 lookups.

The fix is exact rather than a guess: `U + F >= U`, so once `U >= S` push cannot
win whatever the fanout turns out to be, and the answer is pull for free. Below
that, `U < S` bounds the probe by the pull it is being compared against. The
`how` column says which branch decided:

| workload | U + F | S | picked | how |
|---|---|---|---|---|
| scattered mixed | 2,703 | 29,558 | push | exact |
| clustered mixed | 2,366 | 15,669 | push | exact |
| everything dirty | 100,000 | 29,510 | pull | `U >= S` |
| removals 10% | 14,077 | 29,479 | push | exact |
| movement only | 1,231 | 29,431 | push | exact |

Scale changes the answer, which is the whole argument for deciding per sample:
at 20k entities and 8 connections the same `removals 10%` workload picks **pull**
(U = 2,000 against S = 1,341), and at 100k with 32 connections it picks push.

### The shapes, checked before any of it is timed

Seven cases where a router can be wrong in a way a total would hide, run as plain
inputs with no world at all — and the probe refuses to report a single time until
all four arms agree on every one:

an entity with several dirty components · dirty and a removal on the same entity ·
an entity that entered this sample (spawn carries its state, so it owes nothing
else) · an entity that left (nobody hears about it) · one entity visible to eight
connections · an entity nobody can see · nothing happened at all.

Plans are compared as row INDICES in order, which is the decoded wire: same
removals, same delta entries, same sequence. Push and pull both build their
buckets out of order and sort them — on the rows actually SENT, which is 598 at
the mixed workload against the 66,848 visits the sort replaces.

### Shipped, and re-measured on the same bench

`route_` chooses per sample now, from `U + F` against `S`, with `U >= S` deciding
for free. The reverse index is the server's — the projection of `conn.interest`,
maintained from the enters and leaves the visibility pass already produces.

Measured against the old shape put back under the same (fixed) harness, at 100k
entities and 32 connections:

| workload | before | after |
|---|---|---|
| **dirty 100%** | 69,289 | **42,463** (a 39% cut) |
| dirty 1% | 12,837 | 11,662 |
| mixed | 12,426 | 12,234 |
| removals 10% | 15,525 | 15,697 |

Only the saturation case is outside what separate processes vary by. That is not
a disappointment, it is N3a's decomposition holding: at realistic rates the two
filters were a quarter of the sample, so removing almost all of them moves the
whole sample by less than the harness can resolve. What the ROUTING itself costs
is measured where it can be — same process, alternating arms — in the section
above: 783 µs to 85 at the mixed workload, 37,434 to 3,091 with everything dirty.

The shape is the result. What used to grow with `connections × rows` now grows
with the smaller of `affected + fanout` and `total interest membership`.

## What this does not cover

- **Encoding is inside the totals and not separated.** It is proportional to what
  is actually SENT — 598 entries at the mixed point — so it is the floor a
  perfect router leaves behind, not part of the wall. Separating it needs the
  frame writer, which is not on the SDK's entry.
- **The still floor is C × V and nothing else.** 3,573 µs with nothing moving,
  and `µs per (connection × visible entity)` comes out 0.112 to 0.121 across
  every point of the sweep — a quarter of the population at the same C × V costs
  the same, and eight connections cost a quarter of thirty-two. There is no
  population term and no constant. The constant the broken harness appeared to
  have was the `'all'` connection.
- One anchor per connection, and a uniform grid world. `viewers per entity` is
  the number the push/pull choice turns on, and it is a property of how players
  are arranged: 1.00 spread across the map, 8.10 packed into a thousandth of it.
- Client apps are connected but not ticked during measurement. What is timed is
  the server's own sample.
- **The N3b probe routes; it does not send.** Its arms are timed over the same
  inputs the server computes, but nothing is installed on a server and no bytes
  are encoded. What it answers is whether JavaScript's maps and sets overturn the
  crossover the counts predict — they do not, at these points.
- The probe's arm A is a transcription of `sampleWithInterest_`'s two filters,
  not the server running them. The absolute numbers for the shipped path are the
  section above, measured on the real server.
