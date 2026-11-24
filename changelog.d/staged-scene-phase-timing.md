---
section: Fixed
commits:
  - fix(scene): account for active hierarchy work across load slices
---
**Scene load timings now include every entity creation and parent link across frames.** The profiler excludes the time a streamed scene spends waiting for its next slice and the time spent in phase callbacks.
