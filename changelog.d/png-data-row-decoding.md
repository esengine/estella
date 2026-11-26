---
section: Changed
commits:
  - perf(assets): reconstruct data PNG scanlines without an intermediate image
---
**Heightmap PNGs decode with less temporary memory.** The shared PNG decoder restores filtered rows in place when it expands
channels, then gathers RGBA bytes and 16-bit samples in one pass.
