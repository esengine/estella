---
section: Changed
commits:
  - perf(editor): read each mesh box once per viewport pick
  - perf(picking): defer non-mesh eligibility until bounds fallback
---
**Viewport clicks do less work in mesh-heavy scenes.** The shared picker reads each eligible mesh's bounds once, while preserving locked-object and gizmo visibility rules.
