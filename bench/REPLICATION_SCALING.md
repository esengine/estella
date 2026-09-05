# Replication scaling — checkpoint

**Phase complete. Stop optimizing until production evidence violates a frozen
budget or a reopen condition below.**

Seven cuts removed the population scans; the eighth re-took the budget and found
nothing left to remove. What follows is the shape that shipped, what each
direction was ruled, and — the part this document exists for — **what evidence
would justify opening one again**.

## Why this is a stopping point rather than fatigue

`bench/sample-budget` accounts for **over 99%** of a sample at 100k entities and
32 connections, and the remainder is under 1%. Every large phase is proportional
to something that actually happened:

- **still is 25 µs.** The idle path is gone, not cheaper.
- **Dirty discovery examines 1,000 candidates for 1,000 movers**, taking the
  journal projection every sample (3 reads, 0 population scans).
- **92–95% of the first-place phase is the provider computing** — grid walk and
  sphere test, 0.149 µs per (connection × visible entity). The host's share of
  it is 5–8%.
- **Spawn cost tracks entities that genuinely entered a view**, at 3.8 µs each.
- **Encode and transport are 1–2% of CPU.**

The shape the first seven cuts attacked — paying `O(population)` to establish
that nothing happened — is no longer present. `visibility query` is first at
31–43%, and it is first because a connection whose own anchor moved has to be
told what is near it now. That is the question, not the overhead.

## The production complexity that shipped

```
registry topology     O(membership churn)
dirty discovery       O(relevant write journal), population-scan escape hatch
world transform       O(1) idle ensure; composed only after a mutation
spatial index         persistent — O(membership + composed movement)
idle visibility       O(1) generation reuse
moving visibility     O(connections × actual local spatial query)
delta routing         min(affected + viewer fanout, total interest membership)
spawn                 explicit ghost construction + declared replication baseline
wire encode/send      O(actually transmitted work)
```

## Frozen directions and their reopen conditions

| direction | ruling | reopen when |
|---|---|---|
| regional visibility generation | **NO SHIP** | movement becomes sparse, anchors stable, or `cell` decouples from `radius` — AND `bench/interest-regional`'s arm A shows recomputes well under `C` |
| reverse region → connection index | **REJECTED** | only if a new spatial model makes A's and B's invalidation sets stop being equal |
| binary spawn baseline (FrameWriter) | **CLOSED for CPU** | baseline encode becomes CPU-dominant, **or** control-plane bandwidth becomes a real deployment constraint |
| dirty discovery projection | **SHIPPED** | the journal stops being sparse, or the escape hatch starts taking the population scan often |
| adaptive delta routing | **SHIPPED** | reverse viewer-index maintenance becomes a hot phase itself |
| idle visibility generation reuse | **SHIPPED** | the conditions its stamp is a function of change |
| journal retention as a lease | **ACCEPTED CONTRACT** | a real product lifecycle produces long-lived parked readers |

### CPU and bandwidth are separate budgets

`bench/sample-budget` measures CPU and says the spawn baseline is not worth
re-encoding: 3.8 µs an entity, with encode 11% of total spawn cost. It also
records that the control plane carries **178 KB a sample against the binary
plane's 4–8 KB** — twenty to forty times, invisible in a CPU budget.

Those are two gates, not one. Re-opening the binary baseline on bandwidth
evidence — real egress, congestion, mobile traffic, cloud cost — is legitimate,
and the reason must then be written as *bandwidth reduction*, never as
*serializer optimization*. Writing it the second way is how two separated
problems get merged back together.

## Where the evidence lives

| bench | question it settled |
|---|---|
| `bench/replication-interest` | what the per-connection interest path spent its `C × E` on |
| `bench/interest-floor` | the floor under a prepared provider |
| `bench/replication-routing` | push against pull, and the chooser that must not measure to decide |
| `bench/replication-dirty` | dirty-row discovery and delivery |
| `bench/interest-regional` | whether regional invalidation can pay — it cannot, at this cell size |
| `bench/spawn-contract` | what a spawn payload carried, and under which contract |
| `bench/sample-budget` | the whole sample, decomposed to >99% |
| `bench/idle-maintenance` | what a server with nothing to do costs |

## Two harness rules this campaign paid for

- **Reconcile the harness's world model against the system's own accounting,
  every census.** One connection keyed wrong owned nothing, failed open to
  `'all'`, and was handed the population every sample — that Set was every wall
  time in the campaign until `arm.mjs` started comparing `viewerLinks` against an
  independent oracle.
- **Interleave A/B, and read intervals, not points.** This machine drifted 20%
  across a session; two runs of one build produced 45,814 µs and 22,627 µs. Three
  ABA rounds where every pair agrees is the weakest claim worth making.
