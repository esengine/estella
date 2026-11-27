---
section: Fixed
commits:
  - fix(tilemap): compose brush transforms in displayed tile space
  - fix(editor): match tile brush previews to renderer orientation
---
**Tile brushes rotate and flip in the direction shown on screen.** Combining transforms now moves the visible corners as expected. Brush thumbnails and viewport previews match the painted tile, including rectangular tiles.
