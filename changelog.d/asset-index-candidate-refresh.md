---
section: Fixed
commits:
  - fix(assets): refresh loaders when an indexed reference candidate changes
---
**Adding a higher-priority asset updates documents that were using a fallback.** The loader tracks the paths it checked while resolving a reference, so a new texture beside a material can replace the existing project-level match during a live refresh.
