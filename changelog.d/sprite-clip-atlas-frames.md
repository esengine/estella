---
section: Fixed
commits:
  - fix(animation): preserve source frames in packed sprite clips
---
**Sprite animations keep their frame sizes and crops in automatic atlases.** Image sequences, sheet cells and cropped frames draw the same region in Play and in exported games. Texture paths relative to the clip also resolve after content-addressed packing.
