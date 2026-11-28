---
section: Changed
commits:
  - perf(assets): stop dispatching preloads for canceled scenes
---
**Canceled scenes skip asset loads still in their queue.** Active reads finish safely and can still serve another scene or preview that needs the same asset.
