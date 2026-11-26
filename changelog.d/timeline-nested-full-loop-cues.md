---
section: Fixed
commits:
  - "fix(timeline): retain nested loop phase for cue crossings"
---
**Looping nested sequences keep their cues through long playback steps.** The runtime tracks elapsed clip time before wrapping, so a full lap still dispatches crossed cues even when the sampled time ends where it started. Long steps dispatch one covering pass to avoid replaying the same cues in a burst.
