---
section: Fixed
commits:
  - fix(ecs): read current parent and child relationships from the core
---
**SDK lookups follow the current entity hierarchy after engine-side edits.** Scene unload can now detach entities that should survive even when their parent was assigned directly by the engine, preserving their world transforms.
