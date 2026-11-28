---
section: Fixed
commits:
  - fix(picking): account for camera parallax in world selection
  - fix(editor): select parallax layers where the viewport draws them
---
**Parallax-shifted sprites, shapes and meshes can be selected where they appear.** Clicks, marquees and outlines use the camera presented by the editor or Play view, including a rebased render origin.
