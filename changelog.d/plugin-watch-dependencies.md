---
section: Fixed
commits:
  - fix(assets): ignore plugin dependency changes in project watchers
---
**Installing a project plugin's dependencies no longer triggers an editor reload.** The project watcher ignores generated directories inside plugins while still reporting edits to plugin source and manifests.
