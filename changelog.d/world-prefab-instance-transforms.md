---
section: Fixed
commits:
  - fix(world): apply prefab instance transforms before cutting cells
---
**Streamed world cells follow prefab instance transforms.** A root Transform replacement or multiple position overrides place the instance where it actually loads, and its rotation and scale contribute to the bounds of attached scene children.
