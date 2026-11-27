---
section: Changed
commits:
  - perf(tilemap): write chunk export Base64 into a pre-sized string
---
**Large tilemaps export their saved data faster.** Base64url encoding writes directly into the destination string while preserving the saved bytes and chunk order.
