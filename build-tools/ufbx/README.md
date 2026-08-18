# FBX reader (vendored)

`ufbx-load.{mjs,wasm}` — the FBX parser the model import runs, an emscripten
build of [ufbx](https://github.com/ufbx/ufbx) 0.23.0 behind the thin C ABI in
`tools/ufbx-wasm/bridge.c`. Committed so importing an `.fbx` needs **no emsdk
and no Autodesk FBX SDK** — the same pattern as `build-tools/basis/` (the cook's
KTX2 encoder) and `build-tools/shader-twins/`.

`reader.mjs` is what callers use: it hands back one self-describing blob (a JSON
header plus a payload of arrays), which `pipeline/src/assets/fbxImport.ts` reads.
Struct layouts never cross the boundary, so rebuilding ufbx cannot silently move
a field the TypeScript side indexes by hand.

## What the bridge asks ufbx for

Everything that has one right answer is decided in C, once:

| | |
|---|---|
| Axes / units | right-handed, +Y up, one unit is one metre — the engine's, which are glTF's |
| Geometry transforms | become real helper nodes, so the prefab's hierarchy is the file's |
| Polygons | triangulated (`ufbx_triangulate_face`) and re-indexed (`ufbx_generate_indices`) |
| Skinning | four strongest weights per vertex, renormalized; `geometry_to_bone` is the bind pose |
| Animation | `ufbx_bake_anim` — FBX rotates in Euler angles around pivots a Transform has no field for |
| Materials | ufbx's own PBR mapping, so Phong, Maya, 3ds Max and Blender materials all arrive as one set of maps |

## Rebuild

```
node tools/ufbx-wasm/build.mjs
```

Source: `third_party/ufbx` (`ufbx.c` + `ufbx.h`, vendored — the upstream repo
carries 60MB of test data that nothing here needs). ufbx is MIT / Unlicense
dual-licensed; `third_party/ufbx/LICENSE` is the upstream text.

Bump the blob version in both `bridge.c` and `fbxImport.ts` when the blob's shape
changes — the reader checks it and says which side is stale.
