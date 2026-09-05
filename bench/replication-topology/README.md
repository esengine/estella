# Registry topology probe

`reconcileRegistry_()` reads every replicated entity and walks the whole
registry, **every sample, whether or not anything entered or left replication**.
With dirty-field discovery now down to candidates, that scan is what is left of
the O(E) in `sample()`.

This directory measures whether a **topology journal** removes it, and ships
nothing: production still runs the full reconcile.

## The arms

| | membership writes | reconcile |
|---|---|---|
| **A** | nothing recorded | full scan — today's production |
| **B** | journal written | full scan — isolates the journal's write tax |
| **C** | journal written | candidates only |

## The journal is not an add/remove log

It records one thing: *this entity's membership in this component moved at tick
T*. Not what moved, and not in which direction.

That is deliberate, and it is the same rule the field collector follows one
layer down:

```
field replication:   history selects candidates, shadow × world decides truth
registry lifecycle:  topology history selects candidates, known × world decides truth
```

So the reducer is four cells, and every out-of-order sequence falls out of it
rather than being special-cased:

| in `known` | live and replicated | result |
|---|---|---|
| no | no | nothing |
| no | yes | register + spawn |
| yes | no | unregister + despawn |
| yes | yes | nothing |

`add → remove` before a sample is one candidate that is neither known nor live:
nothing. `remove → add` is one that is both: nothing. A journal read as a wire
log would emit a spawn and a despawn for each.

## What it costs, and what it saves

`node bench/replication-topology/run.mjs` — 10k and 100k, five churn rates,
three arms, plus a differential at four points. The incremental registry matched
the full scan at **every sample** of every differential point.

`C/A`, and the tax as a share of one core:

| churn/sample | 10k C/A | 10k A | 10k C | 100k C/A | 100k A | 100k C |
|---|---|---|---|---|---|---|
| 0% | 0.00 | 0.8% | 0.0% | 0.00 | 14.3% | 0.0% |
| 0.01% | 0.00 | 1.3% | 0.0% | 0.00 | 21.8% | 0.0% |
| 0.1% | 0.02 | 1.2% | 0.0% | 0.01 | 20.8% | 0.1% |
| 1% | 0.09 | 1.5% | 0.1% | 0.05 | 28.5% | 1.4% |
| 10% | 0.42 | 2.7% | 1.1% | 0.36 | 39.3% | 14.3% |

Entities visited per sample at 100k goes from 200,000 (the population plus the
registry) to **0, 4, 27, 252, 2502**.

**There is no crossover.** Even at 10% of the population changing membership
every sample — far past anything a game does — C is a third of A. The 0% row is
the one that decides it: at 100k, a registry where nothing entered or left still
costs 14.3% of a core to confirm that.

`B/A` sits between 0.90 and 1.19 across the matrix, which is noise: the journal
is written only when a membership moves, never per field write. That is the
whole difference from enrolling a component in change tracking, where every
write pays.

## What this does not cover

- The journal is reproduced here, not implemented in `ChangeTracker`. Its write
  tax is one map lookup and one push, which is what the real one would be, but
  the real one also has to be produced from `recordAdded` / `recordRemovedById`.
- `world.valid()` in the reducer is belt to `has`'s braces — an entity id carries
  its generation, so a stale handle misses the storage map anyway. Sabotaging it
  alone does NOT redden this probe, and a fixture for handle reuse belongs with
  the production change.
- Interest is untouched. With a policy installed, every ready connection still
  builds `[...known_]` and scans it — once the registry scan is gone, that is the
  next O(C × E).
