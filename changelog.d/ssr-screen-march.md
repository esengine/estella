---
section: Fixed
commits:
  - fix(postprocess): screen-space reflections find what the picture shows, however far
---
**Puddles and mirrors reflect the street, not only the sky.** Screen Space Reflections marched a reflected ray a fixed world distance (4 m by default) in steps even in the world, so a puddle reflected nothing farther than that — the wall, the bridge, the buildings across the street came out as the plain sky the lit surface already showed — and a longer reach made every step coarser. The ray is now clipped to the part of it the picture shows and its steps are spread evenly over the screen, so anything on screen can be found at the same cost; Max Distance stays as an optional limit, now 200 m by default. A ray no longer reads the surface it leaves as its own reflection (dark freckles along a mirror's far edge), and a gap of sky between two surfaces no longer makes it miss the one past the gap.
