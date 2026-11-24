---
section: Fixed
commits:
  - fix(sdk): a UIVisual built with a texture and no visual type draws the texture
---
**`spawnUIEntity` shows a texture given without a visual type.** `buildUIVisual` (and so `spawnUIEntity({ visual })`)
defaulted `visualType` to `SolidColor`, which ignores the texture, so `visual: { texture }` rendered a white box. A
texture with no `visualType` now resolves to `Image`; with neither, the default is still a white `SolidColor`, and an
explicit `visualType` is kept as given.
