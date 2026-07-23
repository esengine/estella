# Native boot-spike proxy — no-JIT frame benchmark

Answers the single scariest question for the native iOS/Android campaign **without an
iPhone**: *does the engine's per-frame CPU work survive iOS's no-JIT constraint?*

## Why this is a faithful iOS proxy

- iOS third-party apps get **no JIT** — JavaScriptCore runs interpreter/LLInt only,
  for **both JS and wasm**. wasm dropping from JIT to interpreter is typically 5–20×.
- iOS's JS engine **is** JavaScriptCore. **Bun** embeds JavaScriptCore too. So running
  this bench under Bun with JIT disabled measures the **same engine** iOS uses, under
  the **same no-JIT constraint** — only the CPU differs.
- On an **Apple Silicon (M-series) Mac** the CPU shares microarchitecture lineage with
  the iPhone A-series, so the Mac no-JIT number is a **close, mildly-optimistic** bound
  for a real iPhone. On an M4 it's decision-grade for a go/no-go.

What it measures: the real engine wasm booted **headless** (`createHeadlessApp` — no
renderer/GL/DOM), N entities, M frames of the actual update loop — ECS iteration +
velocity integration (TS) + `transform_update` matrix propagation (wasm). This is the
CPU per-frame cost **minus GPU submission** (draw-command generation is hard-gated on a
renderer and cannot run headless — that half needs the Electron/WebGL harness).

## Run it (on the M4 Mac)

**1. Get the two build artifacts the bench needs** (both live outside git):

- **SDK node bundle** `sdk/dist/index.node.js` — pure JS, build on the Mac:
  ```sh
  cd sdk && npm ci && npm run build      # produces dist/index.node.js
  ```
- **Engine wasm** `esengine.js` + `esengine.wasm`. wasm is platform-independent, so the
  easiest path is to **copy them from the Windows box** into either
  `build/wasm/web/` or `desktop/public/wasm/` on the Mac (or point `ESENGINE_WASM_DIR`
  at wherever you put them). Building them on the Mac instead needs emsdk + the cmake
  wasm target.

**2. Install Bun** (JavaScriptCore runtime):
```sh
curl -fsSL https://bun.sh/install | bash
```

**3. Run twice and compare** (from the repo root):
```sh
# JSC with JIT (baseline)
bun bench/nojit-frame-bench.mjs

# JSC with JIT DISABLED — the iOS proxy
BUN_JSC_useJIT=0 bun bench/nojit-frame-bench.mjs
#   if that prints ~the same numbers as the baseline, the flag was ignored — try:
JSC_useJIT=0 bun bench/nojit-frame-bench.mjs
```

**Sanity check the flag actually worked:** the no-JIT run MUST be *multiples* slower
than the baseline. If the two are within a few %, JIT was still on — the flag didn't
take; fall back to standalone `jsc` (appendix).

## Read the result

Each run prints `median ms/frame` and a budget verdict:

```
budget  60fps=16.67ms → PASS/OVER   30fps=33.33ms → PASS/OVER  (median)
```

The number that matters is the **no-JIT median ms/frame** at a realistic entity count:

- Comfortably **≤ 16.67 ms** → 🟢 60fps headroom, the no-JIT risk is low, native form
  factor is viable — proceed to the Android real-device architecture spike / iOS shell.
- **≤ 33.33 ms** → 🟡 30fps only; viable for many games, budget-tight — profile hot
  systems before committing.
- **> 33.33 ms** → 🔴 the interpreter can't hold frame budget; rethink (move more work
  into wasm SIMD, cut per-frame JS, or reconsider the JSC-interpreter form factor).

Sweep entity counts to find where it crosses budget:
```sh
BENCH_ENTITIES=10000 BUN_JSC_useJIT=0 bun bench/nojit-frame-bench.mjs
BENCH_ENTITIES=20000 BUN_JSC_useJIT=0 bun bench/nojit-frame-bench.mjs
```

## Config (env vars)

| var | default | meaning |
|---|---|---|
| `BENCH_ENTITIES` | 5000 | moving-sprite entities in the scene |
| `BENCH_FRAMES` | 600 | timed frames |
| `BENCH_WARMUP` | 120 | untimed warmup frames (one-time setup + JIT warmup) |
| `BENCH_LABEL` | auto | tag for the result line |
| `ESENGINE_WASM_DIR` | auto | dir holding `esengine.{js,wasm}` |
| `ESENGINE_SDK` | auto | path to `index.node.js` |

## Reference numbers (harness validation only)

Node 24 / V8 (JIT) on the Windows dev box — **not** iOS-relevant, just proves the
harness and shows scaling (~4M entity-updates/s, ~linear):

| entities | median ms/frame |
|---|---|
| 2 000 | 0.47 |
| 5 000 | 1.18 |
| 20 000 | 5.09 |

The iOS answer is the **Bun JIT-vs-no-JIT ratio × the no-JIT absolute** on the M4.

## Appendix — purest path: standalone `jsc`

Every Mac ships `jsc` inside JavaScriptCore.framework
(`/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc`), with a
true `--useJIT=false`. It's the cleanest number, but the current emscripten glue is ES6
+ has no `shell` environment branch, so it won't load under bare `jsc` as-is. To use it
you must rebuild the glue with `-sENVIRONMENT=shell -sEXPORT_ES6=0` (the toolchain
already does this for the wxgame/single-file variants — see `cmake/Emscripten.cmake`)
and provide a shell-flavored SDK bundle (no `node:` imports). Bun is the pragmatic
first pass; escalate here only if Bun's JIT toggle proves unreliable.
