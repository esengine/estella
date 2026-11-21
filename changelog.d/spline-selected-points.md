---
section: Added
commits:
  - feat(spline): a spline point has a type and tangents, and carries a river's depth, velocity and audio intensity
  - feat(editor): Selected Points in Details steps through a spline's points and edits each, with a river's depth, velocity and audio intensity
---
**Spline points with types, tangents and river values, edited in Selected Points.** Each point of a Spline now says how the curve runs on from it: **Curve** (the smooth curve through the points, as before), **Curve Custom Tangent** (along its own Arrive and Leave Tangents), **Linear** or **Constant**. On a river a point can also carry its own **Depth** (how deep the bed is cut there), **Velocity** (the current there; negative runs back toward the start) and **Audio Intensity** (how loud it sounds there, which a water sample answers as `audioIntensity`); a point that carries none takes the river's own Bed Depth and Flow Speed. Details shows them under **Selected Points**: buttons to step to the first, previous, next or last point, and the picked point's Input Key, Location, Type, tangents, Width and, on a river, its Depth, Velocity and Audio Intensity.
