# shader-twins converters (vendored)

Build-time converters for `tools/gen-shader-twins.mjs` — the WGSL-twin
generation pipeline (REARCH_WGSL Phase 4): assembled GLSL → SPIR-V → WGSL,
appended to a `.esshader` as self-contained `#pragma … wgsl full` sections.

## naga-spv2wgsl.wasm (committed)

SPIR-V → WGSL. A tiny stdin→stdout WASI executable wrapping
[naga](https://github.com/gfx-rs/wgpu/tree/trunk/naga) 30 (`spv-in` +
`wgsl-out`, naga-cli default options), run in-process under `node:wasi` by
`naga.mjs`. Committed so twin generation needs **no Rust toolchain** — the
same pattern as `build-tools/basis/` (the cook's KTX2 encoder).

Source: `tools/naga-spv2wgsl/` (30-line wrapper crate, `Cargo.lock` pinned).
Rebuild:

```
rustup target add wasm32-wasip1
cd tools/naga-spv2wgsl
cargo build --release --target wasm32-wasip1
cp target/wasm32-wasip1/release/naga-spv2wgsl.wasm ../../build-tools/shader-twins/
```

Output is byte-identical to `naga-cli` 30 for the pipeline's inputs (verified
against the fixture shaders when vendored).

## glslang-compile.{mjs,wasm} (committed)

GLSL → SPIR-V. An emscripten build of Khronos glslang (pinned
`third_party/glslang` submodule, release 16.3.0) behind a thin C ABI
(`tools/glslang-wasm/wrapper.cpp`) that mirrors `glslangValidator -V
--auto-map-locations`: Vulkan 1.0 semantics, SPIR-V 1.0, auto-mapped
locations, no optimizer. Run in-process by `glslang.mjs`. Rebuild:

```
git submodule update --init third_party/glslang
node tools/glslang-wasm/build.mjs
```

With both converters committed, `tools/gen-shader-twins.mjs` runs with **no
external tools at all** (only a built engine, `pnpm build:web`). Regenerating
every fixture shader through the vendored pipeline reproduced the committed
twins byte-for-byte (vs. native glslangValidator 16.0.0 + naga-cli 30).
