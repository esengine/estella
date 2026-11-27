---
section: Fixed
commits:
  - fix(export): reject scene formats the runtime cannot load
---
**Export reports scenes in an unsupported format.** The asset cook and runtime use the same scene format check. A scene selected for packaging that fails the check is omitted from the cook manifest and reported by path as an export error. Unused scenes can stay in the project.
