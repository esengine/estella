---
section: Fixed
commits:
  - fix(terrain): resolve tiled terrain files in editor tools
  - fix(terrain): treat tiled terrain documents as path-valued assets
---
**Tiled terrain works with UUID references.** The scene stores a portable link to the terrain file, the inspector offers a terrain file picker, and saving or exporting uses the actual file path. Retrying a failed save still writes newly named texture references to the terrain file.
