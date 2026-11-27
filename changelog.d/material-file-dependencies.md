---
section: Fixed
commits:
  - fix(export): keep indexed material dependencies without file extensions
---
**Exports keep indexed material dependencies even when their filenames have no extension.** The asset scan includes parent materials, shaders, and textures by their registered paths, and the cook rewrites their relative references for content-addressed packages.
