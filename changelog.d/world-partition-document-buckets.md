---
section: Fixed
commits:
  - perf(world): assemble streamed scene documents in one pass
---
**Large streamed 2D and 3D worlds partition faster while preserving scene order.** Export and editor preview share the faster partitioner. A streamed scene with a parent cycle or duplicate entity IDs now reports the issue so export can stop before writing the affected scene's cell files.
