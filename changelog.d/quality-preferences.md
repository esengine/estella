---
section: Added
commits:
  - feat(render): a player's graphics choices hold over the quality level - QualityController.setPreferences takes a render scale, antialiasing off, MSAA or temporal, SSAO and effects to leave out, and they stay through every level the mode or a ceiling picks; temporal smoothing chosen on a level that skips it runs
---
**A settings screen can change the picture without editing profiles.** `app.getResource(Quality)?.setPreferences({ renderScale, antialiasing, ssao, skipEffects })` lays the player's choices over whatever level is in force, and they hold when the level changes; `null` takes them off. The space frigate's graphics panel (O, or the button at the top right) is built on it, and phones now start it on the low level.
