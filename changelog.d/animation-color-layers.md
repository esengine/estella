---
section: Fixed
commits:
  - fix(animation): blend reflected colors as channels on every runtime
---
**Sprite fades keep their authored opacity on native players.** Crossfades, override layers and additive layers now blend declared colors by channel even when an engine binding also supplies four vector coordinates.
