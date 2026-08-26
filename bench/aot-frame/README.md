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

Per entity per frame, in nanoseconds:

| entities | body | interpreted | compiled | ratio |
|---|---|---|---|---|
| 1,000 | thin / thick / heavy / script | 159 / 182 / 171 / 245 | 28 / 30 / 33 / 23 | 5.2–10.6× |
| 5,000 | thin / thick / heavy / script | 162 / 183 / 168 / 251 | 28 / 30 / 34 / 27 | 5.0–9.2× |
| 20,000 | thin / thick / heavy / script | 200 / 241 / 200 / 354 | 32 / 37 / 37 / 29 | 5.4–12.2× |

`script` is `thin` again over a script component instead of the engine's `Transform`.
Interpreted, it is the most expensive row on the board — a pooled component costs more
to hand to a closure than an engine one does. Compiled, it is the cheapest.

**The first measurement of this said 83 ns compiled, and the plumbing was the reason.**
Packing rows was allocating a `[entity, addr, addr]` array per entity per frame,
copying it word by word into the arena, rebuilding the query cache's key from scratch
every frame, and re-finding each component's address resolver per entity. That work is
now a plan built once per system and a flat block written straight through
(`AotDispatch`). Same machine, same minute, interpreted column unchanged:

| | before | after |
|---|---|---|
| thin compiled | 83.1 ns | 27.5 ns |
| script compiled | 81.9 ns | 27.3 ns |
| thin interpreted (control) | 163.2 ns | 162.3 ns |

**The body is only now becoming visible.** Under 83 ns of plumbing, thin and heavy
compiled to the same number; under 27 ns, heavy costs about 20% more than thin. That is
the shape to expect from here: the closer the plumbing gets to zero, the more a ratio
depends on what the system actually computes.

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
