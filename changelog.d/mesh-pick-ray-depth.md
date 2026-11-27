---
section: Fixed
commits:
  - fix(picking): rank opaque meshes by ray depth and respect mesh layers
---
**Click the near model when opaque 3D models overlap.** Editing and Play pick the closest intersected mesh bounds along the camera ray, including from the side. Meshes also respect their authored sorting layers when clicked alongside sprites, and farther meshes remain available when cycling the hits.
