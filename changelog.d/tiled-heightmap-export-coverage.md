---
section: Fixed
commits:
  - fix(terrain): keep heightmap exports in their originating project
  - fix(terrain): reject incomplete full heightmap exports
---
**Full terrain heightmap exports require every tile.** Estella reports missing tiles when exporting a full heightmap. Exports
started in one project or scene are canceled if the editor switches documents before the file can be written.
