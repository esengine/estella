---
section: Fixed
commits:
  - fix(scene): omit native-deleted handles from snapshots
---
**Scene snapshots and the running-world inspector omit entities deleted by the native registry.** The inspector also clears a deleted selection, even when a new entity reuses its native slot. A child whose parent is absent from a snapshot is listed at the root.
