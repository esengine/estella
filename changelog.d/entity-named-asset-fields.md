---
section: Fixed
commits:
  - fix(assets): release named assets after their last entity field changes
---
**Living entities now release animation clips and rig avatars when their last field stops using them.** Persistent entities, standalone scene entities and prepared prefab instances give back their references after a field change or component removal. A second field using the same asset by path or UUID, another instance, or an explicit acquisition keeps it available.
