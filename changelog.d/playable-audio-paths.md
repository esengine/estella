---
section: Fixed
commits:
  - fix(playable): resolve embedded audio aliases consistently
---
**Playable ads resolve Windows-style audio paths to their embedded clips.** Project paths, rooted paths, and UUID aliases can play the same inlined audio without looking for a separate file.
