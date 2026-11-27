---
section: Fixed
commits:
  - fix(picking): share visible bounds between ray and area picks
  - fix(editor): apply click visibility rules to viewport marquee selection
---
**Marquee selection follows the same world visibility rules as clicking.** A disabled renderer, a layer culled by the presented camera, or a hidden editor icon no longer gets selected just because its bounds overlap the marquee. Laid-out UI remains selectable in the same scene order.
