---
section: Changed
commits:
  - fix(gameplay): a third-person camera holds rigidly on its character unless told to trail
---
**A Third Person Camera now holds rigidly on its character by default.** It trailed at a Follow Damping of 12, and a character moved on the fixed step jolted against the world on every frame the step did not run, which on a display faster than 60 Hz is most of them. Follow Damping is now 0 unless a scene sets it, and is shown with the camera's other settings rather than among the advanced ones. A stride warp also measures the character's speed from the time since it last moved, so on such a display its strides no longer flicker between none and double.
