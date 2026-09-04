# Four-arm dirty-oracle probe

Does ChangeTracker-backed candidate discovery cost less than the full shadow
scan replication does today — **without losing any real change**?

This directory answers that and ships nothing. It does not touch
`sdk/src/net/replication/`. It reproduces the production sampling loop so the
arms can differ in exactly one mechanism, and a separate check proves the
reproduction agrees with production.

## The arms

| | write path | sampling |
|---|---|---|
| **A** | tracking off | full shadow scan — today's production |
| **B** | tracking on | full shadow scan — isolates the write tax, alone |
| **C** | tracking on | tracker names candidates, shadow still decides |
| **D** | tracking on | candidates trusted outright |

**D is a counterfactual ceiling.** It assumes the observation completeness this
probe exists to investigate, so it bounds what a future could be worth and
justifies nothing.

## Running it

```sh
node bench/replication-dirty/run.mjs             # the 36-point matrix + recall
node bench/replication-dirty/run.mjs --crossover # the 42-point sweep: where C stops paying
node bench/replication-dirty/run.mjs --quick     # 1k only, for wiring changes
node bench/replication-dirty/completeness.mjs    # which write paths report
```

Every point runs in its **own process**. Change tracking cannot be turned off
once enabled, so arms A and B cannot share a world; and a cold heap, GC history
and JIT profile are not shareable either. Each process therefore pays the same
warmup (300 ticks) before anything is measured (1200 ticks).

## What is measured

The headline is **total replication tax per simulated second** — write tax plus
sample tax. Not sample speedup: the tracker's tax is paid at 60Hz and the scan
saving is collected at 20Hz, and a report that only times the sample can call a
net loss a win.

GC is **not added** to the tax. A collection inside the measurement window is
already inside the wall time being measured; adding it again would double count.
Allocation, heap delta and GC counts are reported beside the tax as explanatory
variables.

Three ratios, three different questions:

- `B/A` — what does turning tracking on cost the write path, alone?
- `C/B` — having paid that, how much scan does candidate pruning save?
- `C/A` — is the whole architecture worth switching production to?

## What makes the numbers comparable

The mutation schedule is a pure function of `(tick, entityCount, dirtyRate)`.
The same entities take the same values on the same ticks in every arm — no RNG
state, so two processes cannot drift. Selection strides by a prime rather than
taking a contiguous run, so a scan cannot be flattered by locality the real
thing would not have.

Output identity is an order-sensitive digest of everything a sample emitted.
A, B and C claim to produce the same replication output and the digests must be
equal; the digest crosses process boundaries, which in-process comparison
cannot.

## Two verdicts, and one of them can veto

**Correctness** asks a narrow question: of everything a complete scan finds
changed this sample, did the tracker NAME it? Not "did the candidate pass emit
it" — a candidate whose shadow happens to agree emits nothing and was still
correctly named. One miss disqualifies the mechanism whatever the timings say,
and the report prints it that way.

`completeness.mjs` asks the same question of the write paths rather than the
workload: a shadow reads the final value and does not care how it got there; a
tracker is an observation and is only usable as an authoritative source if every
legal write path reports.

## What a crossover is, and what it is not

`--crossover` sweeps 1 / 30 / 50 / 70 / 85 / 95 / 100% dirty at 10k and 100k,
arms A/B/C. It answers ONE question: **is a replicated component worth enrolling
in change tracking at all?**

It is not a per-frame switch. Enrolling is not a sample-time flag — the write tax
is paid on every write once a component is tracked, whatever the sampler then
does. So a busy frame chooses between C and B, never back to A, and
`if (dirty > x) fullScan()` recovers nothing. PR6b measured C/B at 0.95–1.04 with
everything dirty: having paid for tracking, candidate pruning is close to free.

Read the tax against a budget as well as against the other arm. The report prints
each total as a share of one core (µs per simulated second, so 1e6 = 100%). Where
both arms are already past one core, `C/A > 1` does not make A usable — neither
arm is.

Both anchors are re-run on the same HEAD as the middle of the curve. Splicing a
1% number from one build onto a 70% number from another is how a benchmark
reports a mechanism change as a workload effect.

## What the crossover sweep measured

`results.crossover.json`, 45 points on one build (the file records the commit and
the artifact hash). Recall complete at every point; A, B and C emit identical
output everywhere.

`C/A`, the whole-architecture ratio:

| dirty | 10k | 100k |
|---|---|---|
| 1% | 0.12 | 0.15 |
| 30% | 0.49 | 0.78 |
| 50% | 0.64 | 0.89 |
| 70% | 0.79 | 0.89 |
| 85% | 0.96 | 1.27 |
| 95% | 1.08 | 1.08 |
| 100% | 1.16 | 1.15 |

**10k crosses at ~87%.** The curve is monotone and the enrollment tax (`B/A`) sits
at 1.06–1.19.

**100k is not precise enough to place a crossing.** Its 85% point is off the curve
— higher than both 95% and 100% — and re-measuring it moved `C/A` from 1.27 to
1.05, with C's write tax falling 20% to meet B's, which is where it belongs since
B and C share a write path. Point-to-point variance at 100k is ±15–20%: enough to
say `C/A` approaches 1 somewhere past 70%, not enough to say where. Placing that
crossing needs repeats and a median, which this sweep does not do.

Read it against the budget too. At 100k, A is already 170% of one core at 1%
dirty and 320% at 30% — where both arms are past the frame budget, `C/A > 1` does
not make A the usable one. The interesting cell is 100k/1%: A at 170% of a core
(not shippable) against C at 25% (shippable).

## Fidelity notes, and what this does not cover

- The shadow is **seeded at registration**, as `registerEntity_` does: an
  entity's first state goes out in its spawn payload, so its first sample owes
  nothing. An empty shadow instead makes the first sample emit the whole world
  and reads as a catastrophic tracker miss that is really just the baseline.
- `isChangedSince` is a strict `>`, so a window must open one tick before its
  first write. Both off-by-ones here were found by the correctness oracle, not
  by reading the code.
- Components are **script components**. Builtin components write through the
  C++ mirror, and their tracking behaviour is not measured here.
- Physics, UI layout and AOT writeback have their own write paths and are not
  covered. None of them is assumed.
- The measurement phase only ever calls `world.set()`: no removal, no despawn,
  no churn. So this says nothing about **topology** discovery — a production
  sampler still finds component removal by comparing against the shadow, and
  owning a `Removed` reader per replicated component is a PR7 question, not one
  these numbers answer.
- `ReplicationServer.sample()` walks every replicated entity to find spawns and
  despawns BEFORE it looks for dirty fields. That scan is not in these arms, so
  a near-zero sample tax here is the dirty-discovery segment vanishing, not the
  whole sample.
