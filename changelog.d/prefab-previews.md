---
section: Added
commits:
  - feat(editor): show prefabs as their contents in the Content Browser and Details
  - feat(render): draw a whole world into the preview target, screen UI included
---
**Prefabs show what they contain in the Content Browser and the Details panel.** A prefab used to be the same icon everywhere. Its thumbnail and its Details preview are now the prefab itself: put in a world of its own on the editor's engine, opened the way Prefab Mode opens it (UI inside a Canvas, laid out on the project's design resolution), framed to what it draws, and rendered through the engine's own render path. A model is seen from the preview angle, which can be dragged in Details, and gets a light when it brings none. A prefab that draws nothing keeps its icon. The world being edited is untouched while previews are drawn.
