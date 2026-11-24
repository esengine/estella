---
section: Fixed
commits:
  - fix(animation): load standalone skeleton atlas pages through the texture loader
---

**Spine and DragonBones keep each atlas page's texture import settings when loaded outside a scene.** Pages backed by the same file can use different samplers. KTX2 pages use the device's supported compression and recover with their original settings after a graphics-device reset.
