---
section: Fixed
commits:
  - fix(editor): light a prefab that brings no light with the studio rig
  - fix(render): a preview picture is lit as its caller says, not as the viewport is
---
**A model prefab no longer shows black in Prefab Mode or in its thumbnail.** A prefab seldom carries a light, so a model opened in Prefab Mode had nothing lighting it. When nothing in a prefab gives light, Prefab Mode now shows it under the viewport's studio lighting (view only, never saved), and puts the lighting back as it was when Prefab Mode ends. The prefab's thumbnail and Details preview follow the same rule with the same lights, and a prefab that brings its own lights is shown by them in both. `get_document` reports which lighting the viewport is using.
