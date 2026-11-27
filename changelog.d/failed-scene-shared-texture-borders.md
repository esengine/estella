---
section: Fixed
commits:
  - fix(scene): publish texture borders only after scene load commits
---
**A failed scene load preserves the running scene's shared texture borders.** Authored 9-slice metadata is applied when the new scene finishes loading, including its setup callback.
