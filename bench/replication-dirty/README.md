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
node bench/replication-dirty/run.mjs           # the 36-point matrix + recall
node bench/replication-dirty/run.mjs --quick   # 1k only, for wiring changes
node bench/replication-dirty/completeness.mjs  # which write paths report
node bench/replication-dirty/churn.mjs         # storage over time
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
