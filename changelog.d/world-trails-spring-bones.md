---
section: Fixed
commits:
  - fix(fx): keep trails and spring bones in their owning world
---
**Trails and spring bones stay with their scene when several worlds share an engine.** Clearing a trail or closing a preview preserves the other scene's ribbons. Moving a parent or emitter now records the new world position in the same update. Character previews now read their own bone poses, and ending a preview restores only its own character.
