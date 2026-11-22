---
section: Fixed
commits:
  - perf(assets): share hot reload across live sprite and mesh owners
---
**Shared textures and other handle-based assets update faster in running games.** Sprites and meshes receive the current asset even when their scene unloads during a reload or another edit supersedes it. Each owner releases its own share when it goes away.
