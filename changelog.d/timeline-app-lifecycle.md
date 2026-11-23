---
section: Fixed
commits:
  - fix(animation): isolate plugin playback and cleanup per app
---
**Apps can share animation plugins and play their timelines independently.** Each app owns its timeline voices, spawned prefabs, sprite frames and playback events. Closing a preview or rolling back a failed installation releases only that app's animation resources.
