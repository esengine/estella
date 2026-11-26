---
section: Fixed
commits:
  - fix(runtime): include native-added renderers in live snapshots
---
**Live inspection shows renderers added by the engine.** A selected Sprite or MeshRenderer appears in Play and connected build details as soon as the core registers it, and the inspection snapshot reuses data it has already read.
