---
section: Changed
commits:
  - perf(tilemap): decode aligned chunks without per-cell coordinate lookups
---
**Large saved tilemaps decode faster.** The shared decoder writes aligned cells directly into their chunk and streams base64
values into bytes. The editor’s tile replacement preview and the runtime’s collision fallback both use this decoder.
