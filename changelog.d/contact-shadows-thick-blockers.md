---
section: Fixed
commits:
  - fix(postprocess): contact shadows find a blocker a step jumped over
---
**Contact Shadows no longer draws a hatch on the ground beside a wall or a crate.** A ray that met a surface seen edge-on, or entered a thick thing through a side the camera does not see, was only counted when a step happened to land in the thin layer under the surface, so the shadow came out as a pattern of the march's own jitter. The march now looks for that layer between two steps that fall on opposite sides of it, and the shadow beside a thick blocker is whole.
