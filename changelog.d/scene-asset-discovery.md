---
section: Fixed
commits:
  - fix(scene): share asset discovery across preload and entity ownership
---
**Scene preparation now asks each component for its assets once.** Authored scenes, packaged scenes and prepared prefabs use the same declarations to load resources and keep them alive on their entities. Custom components can return their dependencies without a later scan changing which resources stay loaded.
