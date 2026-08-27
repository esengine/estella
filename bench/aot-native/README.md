# The no-JIT frame — what a compiled system buys where there is no JIT

`bench/aot-frame` measured this engine's frame twice: on V8 (desktop) and on a
Snapdragon 8 Elite's Chromium. Both have a JIT. Its own README says what is missing:

> **A no-JIT number, and that is the number AOT exists for.**

The plan's proxy for it was a Mac running Bun/JavaScriptCore with the JIT switched off
(`bench/README.md`), and beyond that an iPhone.

**Neither is needed to get the number.** The native host embeds
[QuickJS-ng](https://github.com/quickjs-ng/quickjs), which has no JIT — and it is *the
same host on iOS, Android and the desktop*, one platform seam apart (`native/README.md`).
So the JS engine an iOS build interprets with is the JS engine a Windows build
interprets with. Only the CPU differs. And since the AOT native road landed, that host
dispatches to compiled systems, so both halves of the comparison ship.

This runs the real host, the real SDK and a real exported project, twice from one tree:

```sh
node bench/aot-native/frame-bench.mjs
BENCH_ENTITIES=20000 BENCH_BODIES=thin,heavy,script BENCH_IDLE=1 node bench/aot-native/frame-bench.mjs
```

`estella export` gives the compiled build and `estella export --no-aot` gives the
interpreted twin — `--no-aot` is `mode: 'dev'`, which compiles *nothing*, so the second
build has no module to fall back from. The systems are copied from
`bench/aot-frame/project/src/systems.ts`: one source for both benchmarks, so a ratio
measured here and one measured there are about the same code. The scene is materialized
per run, never committed — an entity count is a parameter, and a scene file per count is
a file per parameter.

Both runs print a checksum of every entity's position from the frame the timed run ends
on, and a run where the two disagree fails. Two worlds that computed different things
have no ratio between them.

## Run it as a criterion

```sh
node bench/aot-native/frame-bench.mjs --gate
```

**The failure this exists for is silent.** `AotDispatcher.run` returns whether it took
the system, and false sends it back to the interpreter for that frame — deliberately,
the no-cliff rule. So a regression that unbinds every system raises no error, refuses no
module and changes no pixel. It only costs time, and nothing was measuring time. A
same-machine ratio sees it: an engine that stopped dispatching reads ~1x. A millisecond
ceiling would not — one calibrated on this machine fails on slower ones and passes on
faster ones regardless of the code.

## What was measured (2026-08-27, i5-14600K, Windows, QuickJS-ng in the native host)

5000 entities, each with `Transform` + `Sprite` + a script component, 200 timed frames
after 120, best of 3 processes. `idle` is the same scene with no body scheduled.

| body | build | frame CPU | draws | the system alone |
|---|---|---|---|---|
| thin | interpreted | 51.06 ms | 1 | 9907 ns/entity |
| thin | **compiled** | **1.72 ms** | 1 | **18 ns/entity** |
| script | interpreted | 15.41 ms | 1 | 2777 ns/entity |
| script | **compiled** | **1.77 ms** | 1 | **27 ns/entity** |
| heavy | interpreted | 61.99 ms | 4998 | 12093 ns/entity |
| heavy | **compiled** | **8.73 ms** | 4998 | **1419 ns/entity** |
| idle | either | 1.52 / 1.63 ms | 1 | — |

**Read the first row as a frame budget.** One system doing three multiply-adds over 5000
entities costs **51 ms** — the scene runs at 19 fps, missing 60 fps by 3.1x and 30 fps by
1.5x. Compiled it costs **1.7 ms**, of which 1.5 ms is everything else in the frame. That
is what this whole road was for, and it is the first time this engine has measured it
where the constraint holds.

### Three things the numbers say that the JIT numbers could not

**1. The no-JIT penalty on this engine's frame is ~61x.** `thin` interpreted costs 9907
ns/entity here against **162 ns on V8** (`docs/REARCH_AOT.md` §18, same body, same
source). Stage 0 measured 154–385x for a bare loop in QuickJS against native C++; on a
real frame, through the real bridge, it is 61x. Compiled, the two hosts land in the same
place (18 ns here, 2.1 ns there — both at the floor of what their idle scene can
resolve), which is the shape AOT should have: the interpreter's speed is the variable
and the compiled body is not.

**2. A script component is CHEAPER than an engine one here — the opposite of the web.**
`script` interpreted costs 2777 ns/entity against `thin`'s 9907: **3.6x cheaper** to hand
a pooled script component to a closure than an engine `Transform`. On V8/wasm the sign is
reversed (251 ns for script against 162 for thin, script the most expensive row on the
board). The reason is the boundary: on this host the SDK is given the engine's heap as
one `ArrayBuffer`, so a script component's bytes are memory JS already has, while an
engine component's address is a QuickJS→C++ call per entity per frame. **Stage 3's
conclusions about the row protocol were drawn on the web host and do not transfer
sign-for-sign to this one.**

**3. `heavy`'s low ratio is not about the compiler.** It writes `transform.position.z`
per entity, which breaks sprite batching into **4998 draw calls** where every other body
draws **1**. Most of its 8.73 ms compiled frame is that render, not the system. The body
was written for a headless harness where nothing renders and the z-write was free; under
a real renderer it is the dominant cost. `draws` is a column for exactly this reason — a
cost that lands somewhere the report cannot see reads as the system's.

## What this is and is not

It **is** the shipped iOS/Android interpreter, on a desktop CPU. QuickJS-ng is what
`native/host/Runtime.cpp` boots on every platform the native host targets.

It is **not** an iPhone number. Two things differ and they pull opposite ways: the CPU is
a desktop one (optimistic), and iOS's JavaScriptCore in LLInt-only mode is generally
faster than QuickJS (pessimistic). Stage 4's exit criterion is still a device run.

It also is **not** a measure of a real game's frame. This scene is almost nothing but the
system: `idle` is 1.5 ms of the 51 ms interpreted frame. A real frame carries physics, UI
and far more rendering that no compiler touches — `docs/REARCH_AOT.md` §14 measured that
share, and it is what turns these ratios into a budget.

## How the host is timed

`native/host/Bench.{hpp,cpp}`, driven by the environment so nothing about a shipped game
changes. Four spans:

- `update` — the `update` call, which only **schedules** the tick: `App.tick` is async and
  returns at its first await. Measured at ~8 µs of a 51 ms frame. Reported so nobody
  mistakes it for the tick again.
- `pump` — the microtask drain that follows, where the systems and the render they drive
  actually run.
- `cpu` — the host's whole frame up to `present()`. The number the tables above use.
- `frame` — including `present()`.

A bench also asks the swapchain to stop waiting for the display
(`WebGPUDevice::setPresentUncapped`, best effort: Mailbox, then Immediate, then Fifo).
**Under Fifo a frame cannot be measured at all**: every frame cheaper than the refresh
interval reads as exactly the refresh interval and every frame dearer than it reads as a
multiple of one. Measured before the mode was added, the 51 ms interpreted frame and the
1.7 ms compiled one read as "52 ms" and "16.5 ms" — a 30x difference quantised into a 3x
one.

The delta is fixed (`ESTELLA_BENCH_DT`, default 1/60) for both the warmup and the timed
frames. A bench stepped by the wall clock measures the wall clock: two builds would see
different deltas, move different distances, and have no differential between them.

| env | default | meaning |
|---|---|---|
| `BENCH_ENTITIES` | 5000 | entities the startup system spawns |
| `BENCH_FRAMES` | 300 | timed frames |
| `BENCH_WARMUP` | 120 | untimed frames first — assets land, pools fill, and a lazily-bound compiled system gets bound before it is timed |
| `BENCH_REPS` | 3 | processes per configuration; the fastest is kept |
| `BENCH_BODIES` | `thin` | any of `thin`, `thick`, `heavy`, `script` |
| `BENCH_IDLE` | off | also run the scene with no body, so a system's own cost can be read off it |
| `BENCH_MIN_RATIO` | 5 | `--gate` only: the ratio a fallback cannot pass |
| `BENCH_KEEP` | off | keep the exported apps for poking at |
