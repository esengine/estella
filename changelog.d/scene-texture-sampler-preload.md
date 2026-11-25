---
section: Fixed
commits:
  - fix(assets): isolate texture sampling for prepared scenes
---
**Preloading a scene preserves the current scene's texture sampling.** A 2D sprite and a 3D mesh can share an image with different scene-authored filtering, wrapping and mipmaps. Each gets its own sampling at load time, including textures read through materials or animation clips. Switching scenes publishes the destination's settings for subsequent loads. Discarding a preload keeps the current settings.
