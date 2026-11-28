---
section: Changed
commits:
  - perf(editor): reuse animator controller matches during preview
---
**Animator debugging and rig selection resolve shared controller references once per scan.** The editor reuses live target matches between preview replies, reducing repeated asset lookups in scenes with many animators.
