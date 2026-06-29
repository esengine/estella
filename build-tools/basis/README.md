# Basis Universal KTX2 encoder (build-time)

Vendored, prebuilt Basis Universal **encoder** wasm used by the asset cook to
transcode source textures (PNG/JPG) into GPU-compressed **KTX2** at build time
(RC6 Batch B4). Encode-time only — the *runtime* transcoder that turns KTX2 into
ASTC/ETC2/BC on-device is a separate side module
(`sdk/src/asset/basisTranscoder.ts` + `src/esengine/bindings/BasisModuleEntry.cpp`).

## Files

- `basis_encoder.cjs` — emscripten glue (the upstream `basis_encoder.js`, copied
  with a `.cjs` extension so Node loads it as CommonJS under this `type: module`
  repo). UMD `module.exports = BASIS` factory; Node-capable (non-threads wasm32).
- `basis_encoder.wasm` — the encoder binary (includes the transcoder too, so the
  cook can validate its own output).
- `encoder.mjs` — the thin Promise API (`encodePngToKtx2` / `encodeToKtx2` /
  `transcodeKtx2ToRgba`) the cook and tests call.

## Provenance & regeneration

Built from the in-tree source at `third_party/basis_universal` via its reference
emscripten project `third_party/basis_universal/webgl/encoder/CMakeLists.txt`
(Release, **non-threads `wasm32`** — the threads variant sets
`ENVIRONMENT=web,worker` and will not load in Node).

```sh
cd third_party/basis_universal/webgl/encoder
emcmake cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --target basis_encoder.js   # -> build/basis_encoder.{js,wasm}
# then vendor the non-threads artifact into this dir:
cp build/basis_encoder.js   ../../../../build-tools/basis/basis_encoder.cjs
cp build/basis_encoder.wasm ../../../../build-tools/basis/basis_encoder.wasm
```

The artifact is committed (rather than rebuilt per cook) so asset cooking does not
require emsdk — the same pattern other engines use for asset encoders. Rebuild
and re-vendor when bumping the `basis_universal` submodule.

## Compatibility note

UASTC KTX2 is emitted **without zstd supercompression** because the runtime
transcoder is built `BASISD_SUPPORT_KTX2_ZSTD=0` (`CMakeLists.txt`). Keep these in
sync: enabling zstd here without enabling it there would make assets fail to
transcode on-device.
