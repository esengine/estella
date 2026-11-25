---
section: Fixed
commits:
  - fix(editor): wait for document and workspace saves before closing
  - fix(project): ship confirmed saves for scene and asset editors
---
**Closing the editor now waits for Save All to finish.** The window stays open if a file or workspace write fails, a scene's Save As dialog is cancelled, or another edit arrives during saving. Ctrl+S follows the visible editor, including import settings in Details and the 2D rig editor. Switching projects finishes pending saves in the project that owns the files.
