---
section: Fixed
commits:
  - fix(scene): preserve stored script components and their saved entity references
---
**Saving a scene preserves script components that its entities still hold after a script reload.** A streamed cell restores ordered target lists with the new entity handles, including repeated targets. Standalone entity snapshots clear references that cannot survive a restart and keep ordinary numeric arrays intact.
