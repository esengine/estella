---
section: Changed
commits:
  - feat(postprocess): contact shadows grade their edge over the sun's disc
---
**Contact Shadows have a soft edge.** The effect's new **Softness** (degrees, default 1.5) treats the sun as a disc rather than a point: four rays to the edges of that cone are averaged, so where a blocker's outline crosses it the shadow is partial and its edge is graded, instead of following the depth buffer's pixel staircase with ragged notches that showed whenever no temporal anti-aliasing smoothed it. 0 keeps the single-ray hard edge.
