---
section: Fixed
commits:
  - fix(editor): align transform gizmos with parallax-shifted selection
---
**Transform handles follow parallax-shifted objects in the editor.** Group rotation and scaling use the visible selection pivot while writing each object's position in its authored world space.
