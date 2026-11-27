---
section: Fixed
commits:
  - fix(assets): use current asset metadata for legacy mesh components
---
**Legacy mesh scenes preload and cook the same assets as current scenes.** The SDK binds meshes and materials referenced through the old component name, and the cooker applies the same automatic texture settings to those meshes.
