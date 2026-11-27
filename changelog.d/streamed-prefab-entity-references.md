---
section: Fixed
commits:
  - fix(world): preserve prefab entity references across streamed scene cuts
---
**Streamed prefabs keep references to persistent scene entities.** The world cut picks up references in added or replaced components and in members added to an instance. Loading reserves those authored IDs so a generated prefab member cannot take the place of an external target.
