---
section: Fixed
commits:
  - fix(assets): share registry loads before calling loader observers
---
**A loader callback can request the same timeline without preparing its children twice.** Both callers receive the same published timeline, and the last release also releases its nested clips.
