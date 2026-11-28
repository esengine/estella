---
section: Changed
commits:
  - perf(assets): load ready label assets during subpackage mounts
---
**Asset labels begin loading ready resources while other minigame subpackages mount.** Main-package assets and assets in mounted subpackages share the configured load limit. Pending subpackages join the same queue when ready.
