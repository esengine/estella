---
section: Fixed
commits:
  - fix(postprocess): contact shadows fade out with distance
---
**Contact Shadows no longer speckles distant ground seen at a low angle.** Far off, the depth buffer cannot tell a surface from the one just behind it, and a ray skimming distant ground found blockers in its own rounding, drawing a band of dark dots short of the horizon. The effect now fades out between Fade Start and Fade End (15 m and 30 m by default, both new settings), and its test for a point lying in front of a surface allows for the depth buffer coarsening with distance.
