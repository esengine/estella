---
section: Fixed
commits:
  - fix(timeline): prepare spawn clips with their scene's texture settings
---
**Timeline spawn clips use their scene's texture settings from the first frame.** Switching timelines while another scene is loaded keeps the correct filtering and wrapping on spawned sprites and meshes. Property and camera tracks can target the new instance as soon as its clip starts. Other clips keep playing if a prefab is missing, and a hot reload can restore that clip during playback.
