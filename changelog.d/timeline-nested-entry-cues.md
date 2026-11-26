---
section: Fixed
commits:
  - "fix(timeline): preserve nested cue entry boundaries"
---
**Nested Timeline cues at time zero fire once on entry or when playback reaches a new loop.** Resuming after a paused seek to time zero continues from that point without replaying the cue at the seek destination.
