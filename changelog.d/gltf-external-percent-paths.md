---
section: Fixed
commits:
  - fix(import): decode glTF dependency paths once
---
**glTF models keep their buffers and textures when source paths contain percent signs.** Geometry and image readers use the same filesystem paths, so the dependencies copied into the project are the ones reimport reads.
