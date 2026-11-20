---
section: Changed
commits:
  - feat(editor): a transform handle behind geometry is a full-colour stipple, as Unreal draws it
  - feat(render): immediate draws can be dithered, one half of a checkerboard at a time
---
**A transform handle behind an object is drawn as a stipple in its own colour, as in Unreal.** The parts of the move, rotate and scale handles that pass behind scene geometry used to be drawn at a quarter of their opacity, which all but vanished over a light or same-coloured surface. They are now drawn on every other pixel at full colour, readable over anything, while the parts in view stay solid. Scripts drawing with `Draw.withDepthState` can ask for the same with `dither: 0` or `1`.
