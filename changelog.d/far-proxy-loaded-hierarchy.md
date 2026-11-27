---
section: Fixed
commits:
  - fix(world): match far proxy hierarchy to the loaded scene
---
**Far proxies match the active hierarchy of the scene they replace.** Baking skips meshes below disabled entities and moving 2D physics bodies. Children of parents omitted from the runtime scene use their own transforms, and deep hierarchies bake without overflowing the call stack.
