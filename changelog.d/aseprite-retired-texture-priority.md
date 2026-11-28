---
section: Fixed
commits:
  - fix(animation): preserve project texture references on Aseprite reimport
---
**Aseprite reimport keeps a retired animation's references to other project textures.** When a manually assigned image and the generated sprite sheet share a filename, reimport preserves the same lookup order as animation playback and export. It freezes only the references that actually used the old generated sheet.
