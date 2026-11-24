---
section: Fixed
commits:
  - fix(editor): use scanned asset labels and loader types in Play
  - fix(assets): deliver labeled resources through the shared batch loader
---
**Asset labels now work from editor Play through packaged games and single-file playables.** Add `labels` to an asset’s `.meta` to ship it with its dependencies. Loading a label mounts its subpackages and returns a bundle that can hold textures, fonts, meshes and lighting together. Changing only a label in a hot update preserves live handles.
