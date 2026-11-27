---
section: Changed
commits:
  - perf(picking): skip icon scaling for sprite bounds
---
**Faster picking in sprite-heavy scenes.** Visible sprites use their own bounds without measuring editor icons. Ray-box tests skip rotation for unrotated objects and stop once a box cannot intersect the ray.
