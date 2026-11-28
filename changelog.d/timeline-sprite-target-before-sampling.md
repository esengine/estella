---
section: Changed
commits:
  - perf(animation): resolve sprite targets before sampling timeline frames
---
**Timeline sprite tracks check the target before scanning frame timings.** Editor scrubbing and runtime playback avoid that work while a track has no drawable target and resume sampling when its target becomes available.
