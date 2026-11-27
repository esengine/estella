---
section: Changed
commits:
  - perf(assets): reduce path work and bound texture usage reads
---
**Texture usage scans finish faster on projects with many scenes and prefabs.** The editor and cooker limit simultaneous file reads and use the project path directly when it already matches an indexed asset.
