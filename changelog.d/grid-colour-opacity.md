---
section: Added
commits:
  - feat(editor): the grid's colour and opacity are viewport settings
  - fix(render): the editor grid looks the same in a linear project as in a gamma one
---
**The viewport grid's colour and opacity can be set, and the grid is no longer glaring in linear projects.** Settings > Viewport gains Grid color and Grid opacity, remembered per user. The grid was also drawn several times brighter in a project using linear colour than in a gamma one (its faint lines blended in linear light); it now looks the same in both.
