---
section: Fixed
commits:
  - fix(assets): keep packaged surface bindings distinct on shared files
---
**Sprites and meshes keep their own textures and materials when two assets ship as one file.** Each texture uses its own sampling and nine-slice settings. Updating one asset changes only the objects that use it. The package still stores the shared file once.
