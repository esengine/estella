---
section: Fixed
commits:
  - fix(terrain): load direct physical materials and keep collision settings during reload
---
**Painted ground keeps its collision material while a file reloads.** Direct physical material bindings now load alongside those supplied by layer info assets. The terrain applies the replacement when it is ready and uses default friction if the material cannot be read.
