# The scale corpus and its budgets

Every scale problem this engine has had was reported by someone whose project was
big enough to notice. 36,000 assets where selecting 22 files and pressing Delete
took 52 seconds to open the confirm dialog. A folder of 788 sprites that decoded
26 megapixels to show the twenty on screen. Nothing in this repository was ever
that big — the examples exist to teach, so they are small, and a cost that only
appears at 50,000 assets is invisible here until a user meets it.

So there is now a project that big, and a set of ceilings it has to stay under.

```sh
node tools/perf-budget.mjs          # make the corpus if needed, measure, gate
node tools/perf-budget.mjs --table  # the last run's table, without re-running
pnpm run scale                      # the same thing
```

## The corpus

`tools/stress-project.mjs` generates it into `build/stress-project/` — an ordinary
Estella project you can open in the editor and press Play on.

| | |
| --- | --- |
| assets | **50,000** (100,004 files with their `.meta` sidecars, ~42MB) |
| textures | 31,496 — including 2,000 in **one folder**, the shape that broke the Content Browser |
| materials / prefabs / audio / data | 6,000 / 4,000 / 3,000 / 3,000 |
| shaders / tilesets / spine sets / fonts | 700 / 200 / 500 / 60 |
| scenes | 43, of which 7 carry the weight |
| `sprites.esscene` | 10,000 sprites over 8 sorting layers, 4 cameras, 200 parents |
| `ui.esscene` | 5,000 UI nodes, six deep, masks nested inside masks |
| `physics.esscene` | 2,000 bodies with colliders |
| `spine.esscene` | 500 skeletons |
| `prefabs.esscene` | 3,000 instances, most of them overriding something |
| `tilemap.esscene` | a 256×256×4 Tiled map |
| `everything.esscene` | all of the above in one document — 20,707 entries, 7.3MB |

It is **generated, not committed**. 100,000 files would sit in front of every
clone, every `git status` and every editor indexing the tree, to store bytes that
are a pure function of one script. The generator is the corpus: no `Math.random`,
no `Date`, every uuid is `sha1(seed + path)`, so the same spec produces the same
tree byte for byte on any machine. It takes about eight seconds to write, and a
stamp file means it is only written when the generator or the scale changes.

`--scale 0.02` makes a 1/50th corpus for a quick local experiment. Budgets do not
apply to it and the gate refuses to run against one.

## The budgets

Declared next to what they measure, in `desktop/tests/scale/*.scale.ts`, each with
the reason it exists. A metric that goes over fails, and prints that reason.

**Why a budget rather than a snapshot.** `tools/perf-guard.mjs` asserts ratios
between microbenchmarks against a recorded snapshot — the right shape for an
architectural invariant, and the wrong one here, because a snapshot can always be
accepted with `--update`. A feature that takes scene-open from 200ms to 900ms
would pass by rewriting the number it is compared against. A ceiling cannot be
raised by the change that breaks it: raising one is its own commit, with its own
reason, and somebody has to decide to write it.

**Why the numbers are not milliseconds.** They would not survive the CI runner,
which has two shared cores. Each run measures three fixed reference workloads and
every metric is divided by the one whose shape it shares:

| unit | the reference | what it stands in for |
| --- | --- | --- |
| `parse` | `JSON.parse` + walk of a fixed 6,000-row document | scene load, serialize, index reads |
| `loop` | a numeric pass over 2M `Float32` lanes | ECS iteration, transform math |
| `io` | `readdir` over 20 shards, then read+parse 10,000 `.meta` | the asset-database walk |

"Cold scan = 8.3 io" means the whole-project scan costs 8.3× what reading 10,000
metas costs on whatever machine is asking. That reads the same on a laptop and on
a runner. The raw milliseconds are recorded beside it, because that is the number
a human wants; it is not the number the gate uses.

The statistic is `min`, for the reason the perf guard already documents: noise on
a shared runner is one-sided, so the fastest sample is the closest to what the
code costs.

The io reference was first written as "read 2,000 files from one folder". After
the first pass that folder is entirely in the page cache, so it measured syscall
and scheduler cost — a regime the 100,000-file scan is never in. On a busy machine
it slowed by 41% while the scan it denominates slowed by 15%, and the ratio moved
the wrong way. Twenty directories and 10,000 files behave like the thing they
divide: run to run, the scan now reads within 3%.

**How the ceilings were chosen.** Each is about twice what it measures today,
which is the same bargain the perf guard makes: run-to-run noise reaches ~10% on
the io-denominated metrics, so this cannot see a 20% slowdown and is not meant to.
It is meant to catch the 2×-and-up kind — the shape a scale bug actually has. The
memory budgets are tighter because bytes are exact, not sampled.

Anything above 70% of its budget is reported as headroom going, which is the only
warning before it stops being headroom.

## What is not here yet

Everything that needs a renderer: draw calls, GPU uploads, frame time with
submission, editor cold start, project scan measured through the editor rather
than the module it calls, Play startup, build duration. Those need the electron
harness (`ESTELLA_SHOT`, the automation surface) rather than a vitest process, and
they are a second tier of this same contract.

## Changing a budget

Change the number where it is declared, in its own commit, and update the `why`
to say what the new ceiling means. If the corpus spec changes, every budget
measured against it changes with it — that is a change to the contract, not a
rebase.
