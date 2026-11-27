---
section: Fixed
commits:
  - fix(terrain): preserve secondary paint from region providers
---
**Terrain providers can supply the upper paint layers on their own.** The page builder preserves layers five through eight when the provider omits the first weight bank, including when a repaint callback is used.
