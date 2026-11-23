---
section: Fixed
commits:
  - fix(water): ripples stepped on the GPU and drawn as geometry, and what floats is held up by the waves the mesh draws
---
**Ripples are stepped on the GPU, and a floating body sits on the water it is drawn on.** A Water Zone's ripples (what a body moving
through the water or a script's `Waters.disturb` sets off) are now stepped on the GPU in passes over a float texture instead of on
the main thread, and the surface is lifted by them, not only shaded: the slope, the foam and the height all come from one texture,
held to a half float instead of 256 steps. Near the camera a ripple is drawn as geometry; a ring of the mesh too coarse for it keeps
it in its shading, as it already did for the shortest waves. The ripple window now sits where the camera looks onto the water rather
than under it, so a camera on a shore looking out keeps its ripples in front of it. `Waters.rippleAt` reads the GPU's grid back a
frame or two late. `Waters.sample`, which holds floating bodies up, no longer adds ripples (they follow the camera, so they differ from
one machine to the next and a server has none), and it now leaves out the waves too short for the surface's finest mesh to draw:
before, it summed every wave and held a body about 7 cm above the drawn waves of a default zone. The underwater waterline reads the
same surface.
