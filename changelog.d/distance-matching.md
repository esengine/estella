---
section: Added
commits:
  - feat(animation): a state can be played by the distance left to travel
  - feat(animator): states and constraints show every setting they take
---
**A stop clip can land where the character stops.** An animator state gains `distanceParameter`: a float saying how far the character has left to go, and the state is played by it, standing each frame at the point of its clip with that much root travel left, so however hard the character brakes its feet come to rest where it does. Under `distanceFloor` world units it plays on by time, and it never runs more than `distanceMaxPace` times its own pace in a frame. For such clips a model's import settings gain Root Motion, From the Skeleton, Its Own Pace, which takes the top joint's course key by key instead of at a steady rate, so a clip that brakes keeps its braking in the root track. The animator's details now show every setting a state and a constraint take, the stride and orientation warps' `ease` among them.
