---
section: Added
commits:
  - feat(export): a game opens before its models are baked, and each model's maps appear as they are done - the bake gives every mesh first, a map is drawn as a flat placeholder until its model is baked and is then decoded again behind the same texture handle, and LoadWork.yieldToGame turns the rest of the bake into short turns that leave the frames their time
---
**A game no longer waits for every model to bake.** Meshes come first; a model's maps are drawn as a flat placeholder until it is baked, and are then swapped in behind the same texture, with no reload. A game's loading screen can open as soon as its scene and shaders are ready and call `loadWork().yieldToGame()`: the rest of the bake goes on in short turns that leave the frames their time. The space frigate opens 7 s sooner (36 s against 43 s on a desktop at 4096), and its hull is sharp a few seconds in.
