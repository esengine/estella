---
section: Added
commits:
  - feat(camera): cameraDirectorReport names the live camera, the blend under way and the cameras chosen among
  - feat(editor): composition guides over a camera's preview, live camera status while playing, and camera rigs in the Create menu
---
**Cameras are authored where they are seen.** Select a camera with a `LookAtTarget` and its viewport preview draws the composition, the screen point and the dead zone, as Cinemachine's Game Window Guides do; drag the point or a dead-zone edge to change them, one undo step a drag. While the game runs, the Outliner marks the live camera (with the blend's progress) and the camera a blend is leaving, and Inspect names them over the game view; `cameraDirectorReport(app)` gives the same to code. The Create menu offers camera rigs: Follow Camera 2D, Tracking Camera, Look-At Camera, Handheld Camera, Dolly Camera with Track and Camera Brain.
