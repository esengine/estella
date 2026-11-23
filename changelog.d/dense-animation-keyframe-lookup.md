---
section: Changed
commits:
  - perf(animation): bound keyframe searches on dense curves
---
**Dense animation clips take less CPU time to play and scrub.** Native and web players use the same keyframe lookup for long imported curves. Short hand-authored curves retain their direct scan.
