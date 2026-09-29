# Lightmap bake kernel

`lightmap-kernel.{mjs,wasm}` — the ray casting a lightmap bake spends its time
in, as an emscripten build of `tools/lightmap-wasm/kernel.cpp` with threads.
Committed so baking needs **no emsdk**, the same pattern as `build-tools/ufbx/`.

`kernel.mjs` is what callers use (`pipeline/src/assets/lightmapKernel.ts` wraps
it as a `BakeExecutor`): it takes a scene's triangles and lumels once, then runs
the direct and gather passes over every lumel on every core. It also decodes
the PNGs a bounce's albedo is averaged from, side by side (stb_image, from
`third_party/stb`).

The rules are `sdk/src/lightmap/solve.ts`'s, term for term, and
`pipeline/tests/lightmap-kernel.test.ts` holds the two to the same atlas bytes.
A change to the solve is a change to both.

## Rebuild

```
node tools/lightmap-wasm/build.mjs
```
