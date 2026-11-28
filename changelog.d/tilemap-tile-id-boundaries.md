---
section: Fixed
commits:
  - fix(tilemap): keep runtime tileset ranges within encodable tile IDs
  - fix(editor): constrain the tile palette to encodable tile IDs
---
**Oversized tilemap palettes stop at the last paintable cell.** Mouse and keyboard selection skip atlas cells beyond tile ID 8191, preventing their IDs from wrapping to empty or unrelated tiles. The runtime applies the same limit to tileset slots, animations and collision metadata.
