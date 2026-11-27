---
section: Fixed
commits:
  - fix(editor): avoid filename collisions when saving terrain images
---
**New terrain images use available filenames.** Saving same-named terrains no longer overwrites another terrain’s newly generated images or an existing PNG with the default name. Later saves reuse the terrain’s bound images.
