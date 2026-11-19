---
section: Added
commits:
  - feat(camera): CameraDeoccluder keeps a target in sight and PositionComposer frames one by moving the camera, in 2D and 3D
  - feat(editor): the camera presets keep a tracking camera's target in sight and frame a 2D camera with a PositionComposer
  - docs(editor): the inspector links CameraDeoccluder and PositionComposer to their documentation
---
**A camera keeps its target in sight, and a 2D camera frames like Cinemachine's.** `CameraDeoccluder` sweeps from the target back to the camera through the 3D physics world and, when a wall comes between them, draws the camera in to just short of it along the line to the target, then eases back out once the wall is gone, as Cinemachine's Deoccluder and UE's spring arm do. `PositionComposer` moves a camera without turning it so its target sits at a screen point, with a dead zone it may wander in and a soft zone it never leaves; it works for orthographic 2D cameras and perspective 3D ones (keeping a distance), and the viewport preview draws and drags its zones. The camera pipeline now runs after the game's own Update systems and reads where each target is this frame: `FollowTarget`, `LookAtTarget` and the dolly framed a moving target one frame late before. The Tracking Camera preset carries a deoccluder; Follow Camera 2D is a PositionComposer.
