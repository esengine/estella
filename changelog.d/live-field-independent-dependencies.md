---
section: Fixed
commits:
  - fix(assets): preserve independent dependencies across live field replacement
---
**Updating a live sprite or mesh field keeps the original asset available to components that declared it separately.** Scenes, persistent entities and prefab instances can keep drawing an independently held texture after the field switches to its replacement. Intermediate field versions are released, including when successive mesh generations use the same native handle.
