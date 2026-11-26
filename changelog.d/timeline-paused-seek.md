---
section: Fixed
commits:
  - "fix(timeline): sample poses and shots on paused seeks"
---
**Paused timeline seeks update the pose and camera.** Calling `Timeline.setTime` on a paused player samples property and animation tracks at the destination, including nested sequences, and updates the active shot. Cues skipped by the seek stay skipped when playback resumes.
