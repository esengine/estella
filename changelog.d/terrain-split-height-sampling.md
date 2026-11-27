---
section: Changed
commits:
  - perf(terrain): reuse height sample coordinates during terrain splitting
---
**Terrain splitting samples heights faster.** The converter computes source positions once per output row and column while preserving the quantized heights of the tiles and overview.
