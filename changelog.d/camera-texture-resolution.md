---
section: Fixed
commits:
  - fix(render): preserve authored camera texture resolution
---
**Camera render textures retain their own resolution.** Mirrors, minimaps, and other camera textures use their configured size even when the project uses design or integer display scaling. Display scaling still applies to the game output and camera previews.
