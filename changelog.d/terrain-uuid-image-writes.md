---
section: Fixed
commits:
  - fix(terrain): resolve height references when naming new weight maps
  - fix(editor): write tiled terrain images to resolved project files
---
**Tiled terrain saves and heightmap imports support UUID-backed images.** The editor writes to the existing project files and names new weight maps beside their height images. Existing UUID references stay in the terrain manifest.
