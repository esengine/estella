---
section: Changed
commits:
  - perf(assets): index live sampler variants by source
---
**Batch hot updates find each animation or tilemap's sampler variants by source file.** Updating a group of documents visits the versions held for those files. Large projects with scenes that use different texture settings spend less time finding which assets to refresh.
