---
section: Fixed
commits:
  - fix(render): stars no longer show through a blended surface in front of the sky
---
**Stars no longer show through a blended surface in front of the sky.** The Starfield effect, and any sky defined with `over`, was added wherever the depth buffer still held the far plane, which a blended surface never writes: stars shone at full brightness on top of a planet's ring, glass or smoke. It now takes how much of each pixel the scene covered from the scene as it was drawn, before any sky effect ran, so a blended surface hides it by its own opacity, also when another sky (a nebula) is drawn ahead of it. A scene that draws its environment as the background keeps the old rule there.
