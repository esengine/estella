---
section: Fixed
commits:
  - fix(foliage): cells standing when a field changes its material draw with a live instance
---
**Grass and plants keep their material when a Foliage field's material is changed.** A cell grown before the change stays until its new version is published, and it used to draw with the old material instance after that instance (or the material it came from) was let go, showing its blades in cyan, magenta and white. A field with a density map, whose new cells come later, showed it most. The cells standing now move to the new material at once, and an instance no cell can move off is kept until the last cell drawing with it is gone.
