---
note: A game no longer has to wait for every model to bake.
commits:
  - fix(export): a texture decoded after the game let a model's baked maps go is read back from the bake, not drawn as a placeholder - a quality change, a scene loaded again or a single-file page decoding late drew the flat placeholder for good once loadWork().release() had cleared the maps; the maps the model was baked with are asked of the bake worker again, which reads them from its cache, and are held for five seconds so the maps of one model decoded together read it once
---
