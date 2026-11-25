---
section: Fixed
commits:
  - fix(i18n): publish prepared scene translations with their owning scene
---
**Preloading a localized 2D or 3D scene keeps the current scene’s captions and language intact.** The destination reads its string tables during preparation and adopts them when it takes ownership of its entities and assets. Discarding a preload returns its table references. Scenes that need the same file still share a single read.
