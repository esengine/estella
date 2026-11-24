---
section: Added
commits:
  - feat(animation): a character walks by the travel its clips state
---
**A character can cover ground by its animation's own travel, so its feet do not slide.** Three pieces, each usable alone. A model's import settings gain Root Motion, From the Skeleton: for a rig with no root above the hips, each clip's travel over the ground is taken out of the top joint and stated as a root track at one steady rate, and a clip that ends where it began is left alone. An Animator gains Rig, the entity whose children its clips pose, for a character that carries its model as a child. A Third Person Controller gains Root Motion: the stick then chooses the heading and the speed it asks the animator for, and the gait that answers is what moves the character. Two things change for what was already there: a root track now covers ground in proportion to the scale of the entity it is the root of, and an imported clip whose first key is a frame in starts at that key instead of standing still before it on every lap.
