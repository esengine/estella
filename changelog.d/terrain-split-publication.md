---
section: Fixed
commits:
  - fix(editor): protect terrain edits during tile conversion
---
**Splitting terrain into tiles preserves existing ground and assets.** The editor writes the tiles and their manifest together in a fresh directory. It binds the result to the scene only if the source terrain still matches the conversion, and project switches wait for the operation to finish.
