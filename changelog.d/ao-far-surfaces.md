---
section: Fixed
commits:
  - fix(postprocess): ambient occlusion leaves open a surface too far off to measure - where the radius is under a texel or two, or one step of the depth buffer is longer than the bias, SSAO and GTAO fade out, where the radius was clamped up to two or three texels and the samples, a depth step apart at random, voted occluded differently each frame: a planet seen from space boiled by eight levels a frame whenever the view moved
---
**Ambient occlusion no longer flickers on a surface seen from very far off.** A planet seen from space, or any ground thousands of units away, boiled from frame to frame whenever the view moved: there the occlusion radius is under a texel or two and the depth buffer's own steps are longer than the bias, so the samples voted occluded at random. SSAO and GTAO now fade out over that range and leave such a surface open; anything near enough to measure is shaded as before.
