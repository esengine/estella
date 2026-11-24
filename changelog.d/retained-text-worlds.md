---
section: Fixed
commits:
  - fix(render): retain glyphs with the world that owns the label
---
**An editor preview can update or close its labels while another scene keeps its own text.** Screen UI and world-space text now keep their glyphs, atlas batches and redraw history with their scene, including when two scenes use the same entity number.
