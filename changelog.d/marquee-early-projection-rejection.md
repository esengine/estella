---
section: Changed
commits:
  - perf(editor): reject off-marquee boxes before corner projection
---
**Viewport marquee selection does less work in large scenes.** It projects fewer sprite and mesh corners by rejecting boxes wholly outside the marquee or the camera depth range up front. Boxes near the boundary still use the exact projected outline.
