---
section: Fixed
commits:
  - fix(editor): clip tile tool picks to the presented camera
---
**Tile tools pick only where the camera draws the map.** Painting, sampling and selection ignore viewport margins and layers outside the camera's depth range. A shape drag that ends outside the view commits at its last visible cell.
