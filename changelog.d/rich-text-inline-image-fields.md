---
section: Fixed
commits:
  - fix(ui): bind rich text images through their generated visuals
---
**Rich text keeps inline images when it wraps and draws the correct atlas frame.** Images referenced in scene and prefab markup ship with the build. Replacing an icon or unloading its label releases the texture when its last user is gone. Single-file playable builds share one texture across frames on the same atlas page.
