---
section: Fixed
commits:
  - perf(assets): retire scene assets through their own lookup keys
---
**Scenes with many tilemaps or character rigs unload faster.** Releasing the last holder now removes only that asset’s names. When a name is reassigned during loading or hot reload, existing holders keep their other names and teardown still releases every dependency.
