---
section: Fixed
commits:
  - fix(render): a WeChat mini-game draws again - the device works out which texture units a program samples from the units it set itself, instead of reading them back with glGetUniformiv, which WeChat's WebGL does not implement
---
**3D games exported to WeChat draw again.** Since 0.105.0 the renderer read sampler units back from the GPU at the end of every frame, a call WeChat answers with `getUniform not support`; `Renderer.end` then failed every frame and the screen stayed black or flickered. The engine now keeps the units it sets itself, and the stand-in mini-game host refuses the call the way WeChat does, so a package that depends on it fails before it ships.
