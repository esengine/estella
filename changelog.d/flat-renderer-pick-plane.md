---
section: Fixed
commits:
  - fix(picking): match flat renderer bounds to their draw plane
---
**Shapes and standalone sprites stay selectable where they draw.** Their picking and prefab preview bounds use the renderer's XY-plane turn, including when a shape inherits a 3D rotation.
