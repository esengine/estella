---
section: Fixed
commits:
  - fix(assets): vertices left on a joint no clip moves are bound as their neighbours
---
**An imported character no longer trails a thin line from one vertex left behind.** Some exporters add a joint beside the skeleton that no clip animates and bind a vertex or two wholly to it; once the character moved, each stayed where the joint was and its triangles were drawn as a sliver across the screen. Importing a model whose clips animate the rest of its skin now binds such vertices as the vertices sharing a triangle with them are, when the joint holds no more than a hundredth of the mesh, and says so in the import warnings.
