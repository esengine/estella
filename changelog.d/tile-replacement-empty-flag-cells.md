---
section: Fixed
commits:
  - fix(editor): apply tile replacement to empty cells with stored flags
---
**Replace Tiles can fill empty cells that still have flip flags.** The preview matches the stored data, newly placed tiles start without flags, and Undo restores the original cell exactly.
