---
section: Fixed
commits:
  - fix(ui): preserve loading textures while updating widget colors
---
**Widgets keep their images when their color changes during loading.** Switching themes, changing a controller page, or running a property action preserves pending textures and materials on other fields. Explicitly clearing a texture still cancels that load. Switching palettes on an existing interface also takes less time in 2D and 3D scenes.
