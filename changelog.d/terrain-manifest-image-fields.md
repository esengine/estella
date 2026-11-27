---
section: Fixed
commits:
  - fix(terrain): share typed manifest image dependencies with asset cooking
---
**Terrain builds use the same manifest fields as the runtime.** Builds stop including images named only in notes or unrelated fields. Invalid paint image references and unsupported heightmap formats now report the manifest error.
