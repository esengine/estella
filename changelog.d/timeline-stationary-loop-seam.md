---
section: Fixed
commits:
  - fix(animation): stop replaying time-zero cues at stationary loop seams
---
**Looping timelines fire the next time-zero cue once playback moves past the seam.** An Animator or standalone timeline parked at that seam no longer repeats the cue on every update. First entry still dispatches its time-zero cues.
