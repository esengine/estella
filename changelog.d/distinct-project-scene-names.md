---
section: Fixed
commits:
  - fix(export): keep colliding project scenes addressable
---
**Scenes with colliding runtime names remain addressable.** A scene in the configured scenes directory keeps its relative name. If an outside scene would share that name, use its project-relative name prefixed with `@project/`.
