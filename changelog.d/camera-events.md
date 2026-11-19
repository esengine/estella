---
section: Added
commits:
  - feat(camera): CameraEvent tells a game when a camera goes live and when the blend into it finishes
  - test(editor): an editor check hears the view's camera events from a game system in play
---
**A game can answer the view changing cameras.** `CameraEvent` is sent when a camera goes live, cut to or blended into, with the camera it left and the blend's length, and again when the blend into it finishes, as Cinemachine's Camera Activated and Blend Finished events are. Read it with `EventReader(CameraEvent)` to show a shot's HUD or hand control back once a transition is done.
