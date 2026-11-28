---
section: Fixed
commits:
  - fix(assets): preserve UUIDs when a watcher reports only a move destination
  - fix(editor): refresh cached assets after duplicate UUID repair
---
**Moving an asset and its sidecar preserves references to its UUID.** The live index recognizes the move even when the filesystem reports only the destination. When copied sidecars lead to a genuine UUID repair, the editor refreshes the affected prefab caches and asset lookups in the same update.
