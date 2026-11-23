---
section: Fixed
commits:
  - fix(timeline): resolve sprite frames against the current track target and asset
---
**Sprite frame tracks animate the sprite named by their child path or player binding.** Rebinding the track or reloading its timeline applies the current frame to the new target or texture, even while the playhead is paused.
