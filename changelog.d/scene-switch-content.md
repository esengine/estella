---
section: Fixed
commits:
  - fix(scene): prepare destination content before retiring the active scene
---
**A failed scene switch or reload keeps the current game running when the destination content cannot be prepared.** An unknown scene name, invalid scene file or rejected preparation leaves the current 2D or 3D scene's entities, systems and assets available for a retry. Streamed worlds keep their current cells until the replacement is ready.
