---
section: Changed
commits:
  - perf(play): share prefab assets between world detection and scene expansion
---
**Play reads prefab assets once per scene load.** The streaming check and prefab expansion share the same asset data, and a scene reload can pick up updated prefab files.
