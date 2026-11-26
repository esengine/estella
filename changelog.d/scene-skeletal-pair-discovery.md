---
section: Fixed
commits:
  - "fix(assets): deduplicate skeletal asset pairs per runtime"
---
**Spine and DragonBones scene assets are discovered independently.** When both runtimes reference the same skeleton and atlas paths, each still gets its own load attempt and contributes to the scene's loading progress.
