---
section: Fixed
commits:
  - fix(assets): keep handle-bound assets with their producing loader
---
**Scenes can keep using assets after a plugin replaces their loader.** The loader that created a mesh still reads its geometry and restores it after device loss. Handle-based assets return to their original loader on release or scene teardown. Plugin types such as `paint:palette` keep their full name in dependency tracking and cleanup.
