---
section: Fixed
commits:
  - fix(assets): rebind stored fields across inactivity and script reloads
---
**Disabled sprites and meshes resume with the current assets after a hot update.** Replacement now reaches inactive descendants and live script components whose definitions were removed or replaced during a script reload. Their fields move to the new asset before the old one is released.
