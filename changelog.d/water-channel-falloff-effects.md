---
section: Added
commits:
  - feat(water): a Curve Channel's bank can run out at an angle from a flat edge, add onto the ground, and take blur, curl noise, smoothing and a terrace mask
  - fix(water): a Curve Channel's outer smoothing no longer raises a ridge where an angled bank starts, nor rings from the inner smoothing
---
**More ways a body of water meets the ground.** A WaterBody's Curve Channel can now be laid **Additive** (the channel added onto the ground as it is, its detail and slope kept), and its bank can use **Falloff Mode: Angle**, running out at **Falloff Angle** from the water until it meets the ground (cut into a hill, built up from a hollow) instead of fading over a fixed width. **Falloff Edge Offset** keeps a flat edge at the water's level before the falloff. The cut also takes **Blur Radius**, two octaves of **Curl Noise** bending its outline, **Inner** and **Outer Smooth Distance** rounding where the bed leaves the bank and where the bank meets the ground, and a **Terrace Mask** (length and start offset) keeping terraces to a span out from the water's edge. Alpha Blend is now the blend a new Curve Channel starts with.
