---
section: Fixed
commits:
  - fix(tilemap): align gameplay coordinates with tile rendering
---
**World-space digs and explosions follow the drawn tile grid.** Tilted layers use the same projected rotation and origin as tile rendering, and an unrotated layer accepts either quaternion sign when building its navigation grid.
