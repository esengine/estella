---
section: Changed
commits:
  - perf(animation): share pose track lookups across sampling, blending and IK
---
**Layered animations spend less CPU time looking up tracks.** Sprite fades, skeletal clips and blend trees reuse track lookups by component and entity. Additive layers read their reference pose directly, and inverse kinematics can look up a joint without scanning the whole pose.
