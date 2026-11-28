---
section: Fixed
commits:
  - fix(animation): resolve frame textures against the live project index
---
**Animation previews and Play use the same frame images.** Flipbook and timeline frames can name textures beside the animation file even before a build catalog exists. Project paths still take precedence unless the reference explicitly uses a relative path.
