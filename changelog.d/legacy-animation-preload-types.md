---
section: Fixed
commits:
  - fix(assets): preserve legacy sprite clip types in preloads and packages
---
**Legacy sprite clips preload through the animation clip loader in the editor and packaged builds.** Older projects used the same metadata type for `.esanim` sprite clips and `.estimeline` timelines. Both paths now use the original filename to distinguish them, including when packaging changes the file extension.
