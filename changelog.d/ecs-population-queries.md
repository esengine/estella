---
section: Fixed
commits:
  - perf(ecs): track world membership and narrow sparse entity queries
---
**Entity queries stay current as the scene changes.** Queries for all entities or just exclusions now see bare spawns and despawns, including spawns committed by a command queue. Every exclusion still applies when another excluded component has never been added. Selecting a rare script tag can visit just its members while keeping the scene's iteration order.
