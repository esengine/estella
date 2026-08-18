# ufbx (vendored)

FBX reader, from https://github.com/ufbx/ufbx — version **0.23.0**
(`fcc5d6ba444cfd3eb80677dba5e37e493941abe5`, 2026-06-22).

Only `ufbx.c`, `ufbx.h` and `LICENSE` are vendored: it is a single-file library
by design, and the upstream repository carries ~60MB of test data that nothing
here builds against. Copied rather than submoduled for the same reason as
`third_party/stb`.

Licensed MIT **or** Unlicense, at the user's choice (see `LICENSE`).

## Who builds it

`tools/ufbx-wasm/build.mjs` compiles this plus `tools/ufbx-wasm/bridge.c` into
the committed `build-tools/ufbx/ufbx-load.wasm`. Nothing else in the tree
compiles it — the engine itself never links FBX.

## Updating

Copy the three files from a newer upstream tree, rerun the build script, and run
`pnpm --filter ./desktop exec vitest run tests/fbx-import.test.ts`, whose
fixtures are hand-written FBX (ASCII) rather than recorded output.
