---
section: Fixed
commits:
  - fix(render): parallax in the editor's view is measured from the scene camera, not from the view's own eye
  - feat(editor): parallax layers in the viewport follow the scene camera, not the view's eye
---
**Parallax layers stay put while you pan or zoom the editor viewport, and move when you move the scene camera.** The
viewport measured parallax from its own eye, so a background at a parallax factor below 1 slid against the rest of the
scene on every pan or zoom, and moving the game's camera moved nothing. Layers now sit where the scene camera puts
them, so the viewport shows the parallax play will have. Show > Parallax from game camera turns this off and shows the
layers where they were placed. Sprites, shapes, text, meshes and tilemap layers all follow it; a game is unchanged.
