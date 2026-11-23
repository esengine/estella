---
section: Fixed
commits:
  - fix(assets): retire entity resources with their registry and asset realm
---
**Replacing or disconnecting a registry now releases the resources owned by its entities.** A new sprite or mesh can reuse an entity number without inheriting old textures. Refreshing the same registry preserves its live assets. Resetting the asset library also closes entity ownership across every world that used it.
