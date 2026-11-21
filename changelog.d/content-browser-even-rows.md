---
section: Fixed
commits:
  - fix(editor): every Content Browser tile is one height, so a row of images no longer runs into the row below
---
**Content Browser tiles no longer overlap the row below.** The grid is laid out in rows of one height, measured off the first row in view, but an image's tile carries a line more than a mesh's (its size) and a folder's a line less, so a row of images under a row of meshes ran into the next row. Every tile now keeps room for the same two lines under its name.
