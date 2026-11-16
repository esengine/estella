---
section: Fixed
commits:
  - fix(render): a glow added to the scene no longer reads as cover - additive and premultiplied-additive draws in the scene added their alpha to the target, so a sky drawn behind the scene took a glowing shield, plume or gate field for something solid and left a black hole the size of it; in the scene they now leave the target's alpha as it was, as they already did in a UI effect layer
---
**A glowing object no longer cuts a black hole in a shader sky.** Additive materials in a 3D scene added their alpha to the picture, so a sky effect that fills only what the scene left uncovered (`defineSkyEffect`) skipped every pixel behind a shield, an exhaust plume or a force field and left it black. Additive draws in the scene now leave the coverage as it was.
