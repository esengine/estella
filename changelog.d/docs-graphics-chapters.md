---
section: Changed
commits:
  - docs(graphics): split the graphics chapters into reference sub-chapters
---
**The graphics documentation is reorganised into sub-chapters and rewritten as reference pages, in English and
Chinese.** Sprites, Camera, Materials & Shaders, Lighting & Shadows, Post-processing, Terrain, Water and Custom Drawing
are each a group of pages (Foliage, Weather, Time of Day and Video stay single pages); old addresses redirect to the
new pages. Statements were checked against the code and corrected where they had drifted — among them the Sprite
`size` default, camera clip-plane field names, the split-screen `viewport` layout, per-quality light, shadow-map and
reflection limits, rain drawn in the world rather than on screen, Voxel GI bounces, and the water ripple and
`Waters.sample` behaviour.
