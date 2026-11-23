---
section: Fixed
commits:
  - fix(runtime): bind streamed worlds to their active scenes
---
**Switching between 2D or 3D maps now streams the cells of the active map.** Editor Play, Web and native packages release the previous map's cells and far proxies when you change maps or return to a menu. Loading a HUD additively keeps the current map streaming. A Web package opened with `?scene=` starts under the selected scene's own name. Returning to a map restores its own remembered entities. Nested scene names and names written in Chinese now keep distinct files in the same package.
