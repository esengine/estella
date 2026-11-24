---
section: Fixed
commits:
  - fix(pipeline): preserve every physical file referenced by an asset
---
**Re-exporting a sprite keeps texture previews still used by 3D meshes.** Packing and cleanup account for shared files, packed assets and independently fetched texture previews. Replacing the last reference removes an obsolete preview. Build size reports charge each file to its delivery group.
