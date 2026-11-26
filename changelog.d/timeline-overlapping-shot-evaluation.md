---
section: Changed
commits:
  - "perf(timeline): select overlapping camera shots in one pass"
---
**Timeline evaluates overlapping camera shots in a single pass.** Playback and Sequencer scrubbing select the current and previous shots without sorting the active clips on every sample. Clips with the same start keep their authored ordering.
