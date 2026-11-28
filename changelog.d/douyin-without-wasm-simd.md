---
section: Fixed
commits:
  - "fix(export): ship Douyin the mini-game runtime built without wasm SIMD"
---
**A Douyin export no longer carries wasm SIMD, which Douyin's iOS host refuses.** Douyin documents that iOS does not support SIMD, and one package runs on both phones, so the export now takes the engine and every side module (Box2D, Jolt, PhysX, Spine, DragonBones, Basis, video) from the mini-game build without SIMD. Those side modules are new builds (`physics-quickgame`, `spine-quickgame`, …) into `build/wasm/quickgame`, beside the engine already built that way, and ship with the editor. A build without SIMD is optimized without it, so an opcode a library forces in fails the build instead of a phone.
