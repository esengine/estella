---
section: Fixed
commits:
  - fix(camera): identify the app that presented a camera
  - fix(editor): scope viewport refresh to the displayed app
---
**Camera changes refresh the viewport that displays them.** The editor updates its overlays and orientation gizmo when its own presented camera changes or disappears. Camera changes in other apps sharing the SDK no longer make the editor repaint an idle viewport.
