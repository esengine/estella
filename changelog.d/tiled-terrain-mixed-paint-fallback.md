---
section: Fixed
commits:
  - fix(terrain): keep procedural paint beside painted tiles
---
**Unpainted terrain tiles keep their procedural materials beside painted tiles.** A detailed render page uses the height and slope rules wherever the source provides no paint map, even when another tile on the page has authored weights.
