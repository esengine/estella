---
section: Fixed
commits:
  - fix(terrain): encode tiled height images in their document format
  - fix(terrain): carry the height format through tiled edits
---
**Grey terrain heightmaps preserve their depth when edited.** Saving or importing heights for tiled terrain configured for Grey
writes 16-bit greyscale tile and overview PNGs so the runtime reads back the saved elevations at full precision.
