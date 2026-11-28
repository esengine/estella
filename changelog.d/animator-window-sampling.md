---
section: Changed
commits:
  - perf(animation): sample transition windows on demand
---
**Animator transition checks sample clip windows only when a condition needs them.** Ordinary playback avoids a redundant window scan, and transitions still publish the windows from the destination clip.
