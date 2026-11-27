---
section: Fixed
commits:
  - fix(editor): migrate scene components before manifest asset preload
---
**Legacy meshes and materials load in scenes opened through editor automation.** The manifest-based loader upgrades old component names before looking up their assets. Saving the scene keeps its mesh and material references.
