---
section: Fixed
commits:
  - fix(export): exporting a game's server again retries the deletes that clear the last export
---
**Exporting a game's server over an earlier export no longer fails at random on Windows.** Before it writes, the export clears the bundle, the deploy files and the engine the earlier export left. On Windows a folder's delete can find a file in it not yet let go and stop with "directory not empty"; those deletes now retry, as the engine's other deletes do.
