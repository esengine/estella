---
section: Fixed
commits:
  - fix(assets): match scene atlas coordinates to the acquired textures
---
**Scenes keep the atlas coordinates that match the textures they acquired.** Updating the asset catalog during a load keeps old handles paired with their matching crops. A failed atlas load preserves the authored crop.
