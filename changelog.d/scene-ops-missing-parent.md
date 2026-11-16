---
section: Fixed
commits:
  - fix(editor): an entity is never created under a parent that is not in the scene - apply_scene_ops took any number as a live id, so a create naming an id not yet allocated could be given that very id and became its own parent: the batch failed with a stack overflow and the saved scene no longer loaded (parent cycle 1 -> 1); a live id is now checked in every op and SceneCommands.create refuses a missing parent before it allocates one
---
**An agent's scene edit can no longer make an entity its own parent.** When `apply_scene_ops` created an entity under an id that was not in the scene yet, the new entity could be given that very id and become its own parent: the call failed with a stack overflow and the saved scene would no longer play ("parent cycle detected"). An id that names no entity is now refused before anything is created, with the message saying how to address an entity made in the same call, and the editor refuses such a parent wherever an entity is created.
