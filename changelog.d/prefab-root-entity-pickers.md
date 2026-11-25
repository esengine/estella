---
section: Fixed
commits:
  - fix(prefab): preserve references to scene instance roots
  - fix(editor): distinguish same-named entity targets in dropdowns
---
**Scene references keep their prefab root when a scene reopens.** UI anchors, joints and other entity fields resolve to the root of their own instance, including a root supplied by a nested prefab. The Inspector shows the hierarchy and entity number for same-named targets. Search accepts a name, path or number, and the skeleton rebinding menu also distinguishes same-named rigs.
