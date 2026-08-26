# AOT frame benchmark — what a compiled system buys a real frame

`bench/aot-stage0` measured a system **loop**: QuickJS against native C++, neither of
them this engine. This measures **this engine**: the same wasm core, the same `App`,
the same scheduler, the same project file — run once interpreted and once with its
compiled twin installed (docs/REARCH_AOT.md).

## Run it

```sh
node bench/aot-frame/build.mjs        # needs emsdk; writes .build/
node bench/aot-frame/frame-bench.mjs  # V8, with a JIT

# scale and effort
BENCH_ENTITIES=20000 BENCH_FRAMES=300 node bench/aot-frame/frame-bench.mjs
BENCH_REPS=9 node bench/aot-frame/frame-bench.mjs
```

`build.mjs` emits three things from one source file (`project/src/systems.ts`): the
compiled twins (`systems.wasm` + `systems.json`, through the real AOT build step) and
the same file as JavaScript for the interpreted run. One source, two worlds — a
retyped copy would only ever agree with its own mistakes.

Each configuration runs in its own process, several times, and the **fastest** rep is
reported: noise on a desktop only ever adds time. The spread beside each row is what
says how much noise there was. Both worlds' final positions are summed and compared —
a run where they disagree prints `RESULT MISMATCH` and fails, because two worlds that
computed different things have no ratio between them.

## What was measured (2026-08-26, i5-14600K, node 24.19.0, Windows)

`the system` is the frame minus an idle run of the same scene. A root transform is
recomposed every frame whether or not it moved, so the idle run is the same engine
work minus the system.

Per entity per frame, across the three bodies (a run varies about ±10% here, so
these are ranges over the bodies AND over repeated runs):

| entities | interpreted | compiled | ratio |
|---|---|---|---|
| 1,000 | 181–239 ns | 95–99 ns | 1.8–2.5× |
| 5,000 | 213–252 ns | 97–117 ns | 1.9–2.3× |
| 20,000 | 253–301 ns | 142–147 ns | 1.7–2.1× |

**The compiled cost does not move with the body.** Thin is three multiply-adds; heavy
is four unrolled integration substeps with a square root and a bounce test each. The
compiled column is the same number for both, at every scale. What a compiled system
costs today is not its code — it is the row array, the address per component per row,
the SysCtx and the `Changed` marking the host does around the call. That is the
measurement REARCH_AOT.md §7.2 was owed: **~110 ns per entity per frame of plumbing**.

**The interpreted cost barely moves with the body either** — under V8 the body is
JIT-compiled to machine code, so thirty extra flops disappear next to the per-entity
protocol (a component copy in, a proxy, a write-back). Both sides are plumbing.

So the ~2× here is **entirely the cheaper boundary**, not faster arithmetic, and it is
the same effect §16 measured for §12.B from the other side.

## What this is NOT

**A no-JIT number, and that is the number AOT exists for.** V8 and JSC compile the
interpreted body to machine code; iOS, WeChat on iOS and QuickJS do not. On those the
interpreted body stops being free and starts costing what Stage 0 measured (154–385×
for the loop alone), while the compiled body still costs nothing. This machine cannot
run that half: `node --jitless` has no `WebAssembly` at all, so the engine will not
boot under it. Run it where a JavaScriptCore is:

```sh
bun bench/aot-frame/frame-bench.mjs                    # JSC, JIT
BUN_JSC_useJIT=0 bun bench/aot-frame/frame-bench.mjs   # JSC, no JIT — the iOS proxy
```

If the two Bun numbers are within a few percent the flag was ignored (see
`bench/README.md`, which documents the same escape for the frame bench beside this one).

It also excludes GPU submission — the app is headless — and this scene is almost
nothing but the system, so the frame ratio here is close to the system ratio. A real
game's frame carries rendering, physics and UI that no compiler touches; §14 measured
that share, and it is what translates these numbers into a frame budget.
