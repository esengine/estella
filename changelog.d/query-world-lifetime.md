---
section: Fixed
commits:
  - fix(ecs): bind query rows and accessors to their world
---
**Systems can safely finish a query after a scene restarts.** A query from the previous world now returns no entities and discards pending writes, even when the new registry reuses an entity number. Interpreted and compiled systems refresh their component access on the next run. Overlapping runs keep their own mutable rows, iteration guards and removal history.
