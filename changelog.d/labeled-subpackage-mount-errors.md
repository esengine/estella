---
section: Fixed
commits:
  - fix(assets): isolate subpackage mount failures in label loads
---
**Asset labels still load available resources when a minigame subpackage cannot mount.** `loadByLabel` reports the affected assets in `bundle.failed`. Successful resources stay in the returned bundle, and a later call can retry the failed package.
