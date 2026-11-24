---
section: Added
commits:
  - feat(animation): an orientation-warp constraint turns the legs to the way the character goes
  - feat(animator): the constraint list offers Legs follow movement
---
**A character going a different way from the one it faces runs with its legs that way.** An animator's constraints gain Legs follow movement (`orientation-warp`): the animator measures the angle between the way the character goes over the ground and the way its motion travels, and the constraint turns the hips by it (within `maxAngle`, 90 degrees by default) and the listed spine joints back by as much, so the chest keeps facing where the character faces. It matters when facing and movement part: a body that turns slower than the way it goes, strafing, aiming. Measured on a run with a body turning at 60 degrees a second, a planted toe slid 50 units through two turns with it and 69 without.
