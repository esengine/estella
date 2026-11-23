---
section: Fixed
commits:
  - fix(water): the scene camera's preview in the editor draws the whole water, not only what the editor's eye sees
---
**The camera preview in the editor shows all of the water.** The water's surface was culled to what the
editor's own eye could see, and the scene camera's preview in Details draws the same surface from
somewhere else: the sea in front of that camera could be missing, or holed, until the editor's eye looked
the same way. While the editor's eye is looking, the surface is no longer culled to it.
