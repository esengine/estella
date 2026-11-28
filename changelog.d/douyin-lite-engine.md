---
section: Changed
commits:
  - "feat(build): build the lite mini-game engine without wasm SIMD"
  - "chore(build): package the lite mini-game engine without wasm SIMD"
---
**Douyin and the other hosts on the engine without wasm SIMD get the lite engine too.** A package whose content uses no particles, post-processing or tilemaps ships the engine without them, as a WeChat one already did: about 380KB smaller raw and 90KB smaller compressed. The new `quickgame-lite` build lands beside `quickgame` and ships with the editor.
