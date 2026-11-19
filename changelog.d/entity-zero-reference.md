---
section: Fixed
commits:
  - fix(scene): an entity numbered 0 can be named by a reference field, and a prefab reference to its own root reaches it
  - fix(editor): a scene opened in the editor gives an entity numbered 0 a new id, and a new scene's camera starts at 1
---
**A reference field can name a scene's first entity and a prefab's own root.** 0 is the "no entity" of every reference field, so an entity whose id was 0 could not be named: picking it in the inspector saved 0, and the field loaded as empty. New scenes numbered their camera 0, and many existing scenes have an entity 0. The editor now gives such an entity a free id when it opens the scene, keeping its place in the hierarchy; save the scene to keep the change. A field that held 0 still means no entity, as it always loaded. Placing a prefab no longer gives its root id 0, so a component inside a prefab that names the prefab's root reaches it. In prefabs written in the old numeric-id format, a numeric reference now names the entity with that id instead of whichever entity happened to be allocated that number. A game loading a scene it has not re-saved behaves exactly as before. One case changes: a save game's world memory recorded for an entity numbered 0 does not reach it once the scene is re-saved with the new id.
