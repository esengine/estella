# Transform invalidation write tax

Composition has to know it went stale, and no single layer sees every producer
that could make it so — a TS write reaches the component heap through a ptr
setter and calls no C++; a C++ system writes the same bytes and tells the
tracker nothing. So the write path itself has to notify.

This measures what that notification costs on the hottest producer there is:
`Query(Mut(Transform))` writing back every row.

## The arms

| | after the component write |
|---|---|
| **A** | nothing — the path as it is |
| **B** | `epoch[0]++` in the WASM heap |
| **C** | `dirty[0] = 1` in the WASM heap |
| **D** | an ABI call across the boundary |

The counters live in the engine's own linear memory (`_malloc` + a `Uint32Array`
view over `HEAPU32.buffer`), not a JS `ArrayBuffer`. The question is what a
second store into memory the write already touches costs, and a typed array
somewhere else would not answer it. The view is re-taken if the heap grew, since
a detached one writes nowhere and would time beautifully.

## What it costs

`node bench/transform-invalidation/run.mjs` — every row's notification actually
landed (the epoch advanced by exactly the number of writes; removing the store
turns that check red).

| entities | A | B | C | D |
|---|---|---|---|---|
| 1k | 63.6 ns | 61.6 | 58.9 | 99.0 |
| 10k | 47.1 ns | 47.0 | 47.3 | 88.9 |
| 100k | 47.8 ns | 48.6 | 48.4 | 89.9 |

As a share of one core at 60Hz, 100k writes per frame: **A 28.7%, B 29.1%,
C 29.0%, D 53.9%**.

**A store into linear memory is free at this resolution.** Writing a Transform
already costs ~48 ns; one more word alongside it does not show up above the
noise, at any size, and the adversarial case — every logical write, zero
semantic movement — measures the same. Across runs B and C land on either side
of A, which is the finding rather than a flaw in it: the difference is smaller
than the run-to-run spread.

**An ABI call is not.** Crossing the boundary for one integer costs 42 ns per
write, +88%, and turns 100k writes per frame from 29% of a core into 54%.

**A monotonic epoch and a dirty bit cost the same.** There is no performance
argument for the weaker one, so the choice can be made on what is easier to
reason about: a generation can say *which* compose a consumer is holding, a bit
can only say that one is owed.

## What this does not answer

- One notification per logical writeback, deliberately — the most conservative
  shape, and the one every producer can satisfy without coordination. Batching
  per system or per AOT invocation would be cheaper still and is not needed to
  make the number acceptable.
- The C++ producers are not measured here. They write the same bytes from the
  other side, and a store there is not more expensive than a store here.
- Nothing about how a consumer finds WHICH transforms changed. An epoch answers
  "is the composition stale", in O(1). Enumerating changed composed transforms
  is a different structure and a different question.
