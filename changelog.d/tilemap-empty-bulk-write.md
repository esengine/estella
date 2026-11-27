---
section: Fixed
commits:
  - fix(tilemap): clear flat tile layers on an empty bulk write
---
**An empty bulk tile write clears the layer.** The SDK sends the clear without allocating a buffer, and the engine retains the layer and its settings. Clearing an already empty layer leaves its revision unchanged.
