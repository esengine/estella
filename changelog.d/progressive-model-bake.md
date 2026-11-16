---
section: Added
commits:
  - feat(export): a game opens before its models are baked, and each model's maps appear as they are done - the bake gives every mesh first, a map is drawn as a flat placeholder until its model is baked and is then decoded again behind the same texture handle, and LoadWork.yieldToGame turns the rest of the bake into short turns that leave the frames their time
  - fix(export): a model baked at load keeps its maps until the game lets them go - a scene loaded twice decoded its textures again after the first take had dropped them and drew placeholders for good; LoadWork.release replaces yieldToGame, whose short turns left a hull blurred for most of a minute
---
**A game no longer has to wait for every model to bake.** Meshes come first; a model's maps are drawn as a flat placeholder until it is baked, and are then swapped in behind the same texture, with no reload. A loading screen can open as soon as its scene and shaders are ready, or wait for `loadWork().run()` to finish; either way it calls `loadWork().release()` once the game is on, so the baked pixels kept for a scene that loads them twice are let go; a map decoded after that, by a quality change or a scene loaded again, is read back from the bake's cache rather than drawn as a placeholder.
