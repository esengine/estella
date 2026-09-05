# Interest path decomposition

With the registry's O(E) gone (N1.5b), `sampleWithInterest_` is what is left. It
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

## What that says about N2b

**Half the cost at 10k, two thirds at 100k, is ownership lookup — and none of it
needs a spatial index.** An index answers it in O(owned): 3.2 million visits
become 32.

So the order is settled: **ownership index first, spatial provider after.** Going
straight to a provider would remove anchors, radius and ownership in one change
and leave nobody able to say which part paid.

What is left in B is the real spatial problem, and it is still the larger half —
5.8 seconds per simulated second at 100k × 32. That is what a provider has to
attack, and it is worth attacking on its own terms rather than as a side effect.

## What this does not cover

- Position lives in a script component, not the builtin `Transform` the shipped
  default reads. A builtin read crosses the wasm boundary, so arm A is
  UNDERSTATED here and every ratio is conservative.
- One anchor per connection. `radiusInterest` allows several, and the radius
  pass is then `candidates × anchors` — this measures the floor of that pass.
- The per-connection dirty and removal filters are timed and counted but stay
  tiny at these rates. If a provider removes the interest query, `C × (D + R)`
  is the next thing to look at — measured, not guessed.
- Custom `position()` readers are why a provider cannot simply index everything:
  the server has no way to know when a caller's arbitrary function would return
  something new. That is a design constraint for N2b, not a cost measured here.
