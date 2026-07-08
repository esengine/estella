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

## GLSL → SPIR-V (still an external tool)

`glslangValidator` (Vulkan semantics, `-V --auto-map-locations`) must be on
PATH — it ships with the Vulkan SDK, Khronos also publishes standalone release
binaries. Vendoring it as a wasm build (Khronos glslang has an official
emscripten/JS target) needs the glslang source tree in-repo; that dependency
addition is a project decision, tracked in docs/REARCHITECTURE.md.
