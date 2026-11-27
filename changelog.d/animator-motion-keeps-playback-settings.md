---
section: Fixed
commits:
  - fix(animation): preserve Animator playback settings when replacing motion
---
**Changing an Animator motion keeps the state's playback settings.** Replacing or clearing a clip or blend preserves root motion, speed parameters, and distance matching settings.
