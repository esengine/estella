---
section: Fixed
commits:
  - fix(lighting): sample material-owned albedo in lightmap bakes
---
**Lightmap baking samples inherited albedo textures on foliage and materials with an authored albedo slot.** Relative textures resolve from the material that specifies them, and the bake honors the shader's cutoff default, the texture switch, and an instance clearing the texture.
