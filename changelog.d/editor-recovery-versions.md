---
section: Fixed
commits:
  - fix(editor): preserve and compare recovery copies across sessions
  - fix(project): ship versioned editor recovery copies
---
**The editor keeps separate recovery copies when you reopen a project and continue editing the same file.** Open File → Recovery Copies to compare a version with the saved file and choose which version to restore or discard. The version menu matches the editor theme and supports arrow keys, Enter and Escape. The remaining copies stay available after another save. Retrying an interrupted 2D rig recovery also preserves bone bindings when an animation was renamed between attempts.
