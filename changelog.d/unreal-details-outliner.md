---
section: Changed
commits:
  - feat(editor): Details, the Outliner, Add Component and asset tiles as Unreal lays them out
  - feat(editor): move to Details, Outliner and asset tiles laid out as Unreal's
---
**Details, the Outliner, Add Component and the Content Browser tiles follow Unreal.** Details lists the entity's components as a tree above the properties: the entity's row shows all of them, a component's row shows that component alone. The Outliner lists an open entity's components under it, typed "component", joins every row to its parent with guide lines, and calls a prefab instance's type "Prefab"; picking a component row selects its entity with that component shown in Details. **+ Add Component** drops its list under the button, one compact row per component. Asset tiles sit closer, as cards with the thumbnail on top, the type's colour under it, the name, and what kind of asset it is. The panel you are working in marks its tab with an accent line along the top.
