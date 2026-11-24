---
section: Changed
commits:
  - perf(native): speed up scene loading with sequential entity IDs
---
**Native games using QuickJS load scenes with sequential entity IDs faster.** The runtime update speeds up entity lookups during validation and loading for both 2D and 3D scenes. Games packaged with older bytecode reuse the device’s updated cache after the first launch.
