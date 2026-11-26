---
section: Changed
commits:
  - "perf(animator): index source entities for target path discovery"
  - "perf(editor): ship faster scene target path discovery"
---
**Animation and Timeline target paths load faster in large scenes.** The editor groups authored entities by parent in one pass when listing animation rig paths or Timeline camera and entity targets.
