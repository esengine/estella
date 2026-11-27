---
section: Fixed
commits:
  - fix(asset): resolve Windows project paths consistently across runtimes
---
**Project asset paths written with Windows separators resolve in editor Play and packaged games.** Existing scenes with these paths can load their prefab instances and nested assets through the same references the exporter discovers.
