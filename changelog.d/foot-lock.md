---
section: Added
commits:
  - feat(animation): a foot-lock constraint holds a standing foot where it stands
  - feat(animator): the constraint list offers Foot stays put
---
**A character turning on the spot no longer spins its feet over the ground.** An animator's constraints gain Foot stays put (`foot-lock`): while the clip has a foot down, the foot is held to the ground point and the heading it landed with, and the leg bends to reach as the body turns or is carried over it. When the body has turned or gone too far, that foot takes a step to where the clip now has it, one foot at a time. The foot's height stays the clip's, so it works beside Foot on ground. Constraints on an animator that names a Rig are now solved in the rig's own space.
