---
section: Fixed
commits:
  - fix(editor): hide tile overlays when the camera clips the whole tile plane
---
**Tile overlays disappear when the camera clips the map's entire flat plane.** The editor uses the rendered camera's depth range to hide the grid and paint previews along with the tiles.
