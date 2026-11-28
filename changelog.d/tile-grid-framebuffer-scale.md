---
section: Fixed
commits:
  - fix(editor): align projected tile grids with the measured canvas scale
---
**Projected tile grids stay aligned when the editor measures the canvas scale.** The overlay refreshes with the same framebuffer-to-screen scale as the viewport. Grids and brush previews reuse projections where neighboring cells share a vertex.
