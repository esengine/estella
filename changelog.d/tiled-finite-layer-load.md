---
section: Fixed
commits:
  - fix(tilemap): load finite Tiled maps through the bounded layer store
---
**Finite Tiled maps respect their declared grid when loaded directly.** Direct loads and scene loads use the same bounded store. A finite layer can send its tiles in one bulk write, while infinite maps still load by chunk.
