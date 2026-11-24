---
section: Fixed
commits:
  - fix(ui): keep layout and picking with each world
---
**An editor preview can lay out its Canvas while another world keeps its HUD and click targets.** Alternating 2D or 3D scenes on one engine reuses each scene's layout. Screen overlays, sprites under a Canvas and delayed pick results use the world they were requested for.
