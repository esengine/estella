---
section: Fixed
commits:
  - fix(scene): retry failed proximity streaming operations
---
**Proximity streaming recovers after temporary load and unload failures.** The next update after the retry cooldown checks whether the cell is still wanted before retrying. Resetting and registering a cell again keeps its outstanding operation serialized.
