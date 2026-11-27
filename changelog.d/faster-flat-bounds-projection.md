---
section: Changed
commits:
  - perf(bounds): reuse rotated corners for flat entity boxes
  - perf(editor): project a single face of flat world bounds
---
**Flat world bounds take less work to project.** Editor marquee selection and Edit and Play outlines project each corner of a flat box once, including when the shape crosses the camera's near or far plane.
