---
section: Fixed
commits:
  - fix(export): fail builds with missing required scene assets
---
**Export fails when a selected scene is missing from the asset index.** The diagnostic gives the scene path and points to its metadata. A scene registered as a different asset type also fails the build. Scenes excluded from packaging remain optional.
