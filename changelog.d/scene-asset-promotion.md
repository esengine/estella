---
section: Fixed
commits:
  - perf(scene): index the assets that persistent entities carry between scenes
---
**Switching scenes with many persistent entities is faster.** Tilemaps and character rigs share the scene's asset lookup during transfer. Meshes and textures with equal numeric handles retain their own resources, and a persistent sprite keeps the clip its UUID resolves to even when the scene loaded it by path.
