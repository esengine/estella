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

`build.mjs` emits four things from one source file (`project/src/systems.ts`): the
compiled twins (`systems.wasm` + `systems.json`, through the real AOT build step) and
the same file as JavaScript, twice — once for node, once for the browser. One source,
two worlds — a retyped copy would only ever agree with its own mistakes.

### On a phone

```sh
node bench/aot-frame/serve.mjs        # prints the URLs it is reachable at
adb reverse tcp:8788 tcp:8788         # over USB: no Wi-Fi, no firewall hole
adb shell "am start -a android.intent.action.VIEW -d 'http://127.0.0.1:8788/?entities=5000&reps=3'"
```

The page runs the same loop (`measure.mjs`) against the same three artifacts a shipped
web build carries, prints the table on the device, and posts it back to the terminal
that served it. Quote the URL for the DEVICE's shell — an unquoted `&` there truncates
the query string and the run silently uses defaults.

The screen must stay on: a browser whose page is not visible stops being scheduled, and
the run simply never finishes. `adb shell svc power stayon usb` keeps it awake while
plugged in (and `svc power stayon false` puts it back).

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

**Then the rows stopped being repacked at all.** A row table is a function of which
entities match and where their components are; both have an authority that answers
cheaply (the query cache hands back the same array while its answer stands, and
`Registry::layoutEpoch` sums every pool's own version), so when neither moved, last
frame's rows are this frame's. Same bench, after that:

| | packed every frame | kept |
|---|---|---|
| thin compiled | 27.5 ns | **2.1 ns** |
| script compiled | 27.3 ns | **2.8 ns** |
| heavy compiled | 33.8 ns | **9.4 ns** |

**The body is the cost now**, which is the shape AOT should have: heavy is 4x thin
where under 83 ns of plumbing the two were indistinguishable. Ratios at 5,000 entities
run 19x (heavy) to 110x (script).

## On a real phone (2026-08-26)

Xiaomi 24129PN74C — Snapdragon 8 Elite (SM8750), Android 16, Chromium 135 — 5,000
entities, 400 frames, 200 warmup, 3 reps, over USB with `adb reverse`:

| body | interpreted | compiled | frame |
|---|---|---|---|
| thin | 345 ns/entity (1.83 ms/frame) | 3.5 ns (0.124 ms) | 14.8× |
| thick | 425 ns (2.23 ms) | 7.5 ns (0.144 ms) | 15.5× |
| heavy | 385 ns (2.03 ms) | 11.1 ns (0.162 ms) | 12.5× |
| script | 486 ns (2.54 ms) | 2.8 ns (0.121 ms) | 21.1× |

Every checksum matched its interpreted twin.

**Read the first row as a frame budget.** One trivial system over 5,000 entities costs
**1.7 ms of a 16.7 ms frame** interpreted — 10% of 60fps for three multiply-adds — and
**0.018 ms** compiled. That is the number this whole road was for.

The phone is 1.6–1.9× slower than the desktop on the interpreted side and **about the
same on the compiled side** (2.8–11 ns against 2.1–9.4): what is left of a compiled
system is a memcpy and a wasm call, and those are memory-bound rather than
core-bound. The shape is the desktop's shape, so nothing about these ratios was an
artifact of one machine.

## What this is NOT

**A no-JIT number, and that is the number AOT exists for.** V8 and JSC compile the
interpreted body to machine code; iOS, WeChat on iOS and QuickJS do not. On those the
interpreted body stops being free and starts costing what Stage 0 measured (154–385×
for the loop alone), while the compiled body still costs nothing. **Android does not
answer this**: its browsers and WebView have a JIT like any desktop's, which is why the
phone numbers above look like the desktop's. Neither does `node --jitless` — it has no
`WebAssembly` at all, so the engine will not boot under it. Run it where a
JavaScriptCore is:

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
