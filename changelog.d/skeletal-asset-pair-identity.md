---
section: Fixed
commits:
  - "fix(editor): reconcile spine ownership with shared pair keys"
  - "fix(assets): share collision-safe skeletal pair keys"
---
**Skeletal assets with colons in their URLs keep their own skeleton and atlas.** Spine and DragonBones share the same pair keys for discovery and loading. The editor uses those keys when retaining Spine assets and releases the scene's reference when the last matching component is removed.
