---
section: Added
commits:
  - feat(camera): virtual cameras switch by priority with a CameraBrain blend, and LookAtTarget frames a 3D shot, in one camera pipeline
  - feat(editor): the inspector links LookAtTarget and CameraBrain to their documentation
---
**Cameras now work like Cinemachine: the highest-priority camera is live, a `CameraBrain` blends into it, and `LookAtTarget` frames a target on screen.** Every camera is a virtual camera, moved each frame in a fixed order: position (`FollowTarget`), then rotation (`LookAtTarget`), then limits (`CameraBounds`). `LookAtTarget` turns a 3D camera so a target is held at a chosen point of the screen, with a dead zone and eased turning, without roll, and works under a parent. Among the active cameras the one with the highest `priority` is live; add a `CameraBrain` to a scene and the view blends to a camera that goes live instead of cutting, starting from wherever the view is if it changes again mid-blend. Before this, priority picked nothing: the first active camera always won. A `FollowTarget` or `LookAtTarget` target set in a scene now reaches the entity it names; before, only a target set by a script worked. `CameraBounds` measures the camera's real shape on screen instead of `Camera.aspectRatio`, which the renderer does not use.
