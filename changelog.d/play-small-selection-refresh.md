---
section: Changed
commits:
  - perf(runtime): avoid world-wide scans for small hierarchy selections
---
**Inspecting a small group in Play stays responsive in large scenes.** The selected row reads its children directly and presents them in the same order as the runtime hierarchy.
