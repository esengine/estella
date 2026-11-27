---
section: Fixed
commits:
  - fix(world): reject unrepresentable streamed partitions
---
**Play and export report invalid streamed-world geometry before publishing cells.** They reject non-finite cell sizes, root positions outside the representable grid, and cell bounds that overflow when composing transforms.
