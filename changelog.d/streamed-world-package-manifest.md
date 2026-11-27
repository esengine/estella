---
section: Fixed
commits:
  - fix(runtime): resolve streamed world manifests through active assets
---
**Re-entering a streamed scene uses its current world manifest.** World manifests resolve through the active package, and a changed file location or content version refreshes the cached cell layout when the scene loads again.
