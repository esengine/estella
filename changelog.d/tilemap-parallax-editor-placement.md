---
section: Fixed
commits:
  - fix(editor): align tile painting and outlines with parallax preview
  - fix(camera): publish the rendered parallax anchor for editor overlays
---
**Paint the tile you see in parallax preview.** The brush, selection and layer outlines follow the rendered tilemap when the game camera moves. Collision outlines continue to show the positions used by physics.
