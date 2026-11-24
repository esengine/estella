---
section: Fixed
commits:
  - fix(ecs): keep deferred commands with their originating world
---
**Restarting a world while a system runs keeps the replacement 2D or 3D scene intact.** Queued spawns, component edits, hierarchy changes and resource writes expire with their original world. A restart during a despawn also retires the remaining commands from a compiled system. Unpublished spawn reservations return to the outgoing registry, and retained command builders return an invalid entity. Overlapping asynchronous runs submit their own commands when each run finishes.
