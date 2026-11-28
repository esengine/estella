---
section: Fixed
commits:
  - fix(animation): cancel obsolete timeline cues after a seek or stop
---
**Timeline callbacks can seek or stop playback immediately.** The superseded step drops its remaining cues and nested state writes, including when a marker seeks from the end of a clip.
