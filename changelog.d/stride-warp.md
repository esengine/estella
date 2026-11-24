---
section: Added
commits:
  - feat(animation): a stride-warp constraint fits a clip's strides to the character's speed
  - feat(animator): the constraint list offers Stride fits speed
---
**A character moved by its controller can fit its strides to the speed it is going.** An animator's constraints gain Stride fits speed (`stride-warp`): each frame the animator compares how fast the character went over the ground with how fast the playing motion's root track travels, and the constraint draws each foot in or lets it out along the way the character is going, about the hip, by that ratio (held between `minStride` and `maxStride`, 0.5 and 1.6 by default). The foot keeps its height and the way it faces. With it, a character can be moved by velocity, so the stick decides how it speeds up, brakes and turns, and its feet still keep pace while it does.
