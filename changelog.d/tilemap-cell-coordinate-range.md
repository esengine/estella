---
section: Fixed
commits:
  - fix(tilemap): reject cell coordinates outside the native grid
  - fix(editor): validate tile replacement coordinates before applying edits
---
**Out-of-range tile coordinates cannot wrap to another cell.** The toolkit checks coordinates before calling the engine, and the editor rejects an invalid replacement selection before modifying any tiles.
