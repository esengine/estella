---
section: Added
commits:
  - feat(camera): CameraDolly rides a camera on a Spline track and CameraNoise drifts its view like a handheld camera
  - feat(editor): the inspector links CameraDolly and CameraNoise to their documentation
---
**A camera can ride a track and drift like one held by hand.** `CameraDolly` puts a camera on a `Spline`: at a set place, level with a target as it moves (a tracking shot), or running at a speed round a closed track, with damping, taking the short way round across a closed track's seam. `CameraNoise` adds smooth Perlin drift and nod to a camera's view, from a slight handheld wobble to a vehicle's sway; it moves only what is drawn, never the camera's `Transform`, and is applied before the view blends between cameras, so a blend into a steady camera settles. Both are stages of the camera pipeline, beside `FollowTarget` and `LookAtTarget`. A `FollowTarget` under a parent now keeps its offset in the world, as documented, instead of in the parent's space.
