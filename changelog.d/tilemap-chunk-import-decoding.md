---
section: Changed
commits:
  - perf(tilemap): decode chunk import Base64 into a pre-sized buffer
---
**Large tilemap saves load faster.** The engine decodes saved chunks in groups into a single buffer and continues to accept existing saves with standard or URL-safe Base64.
