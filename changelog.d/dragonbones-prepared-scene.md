---
section: Fixed
commits:
  - fix(scene): release DragonBones atlas pages when a preload is discarded
---
**Discarding a preloaded scene now releases its DragonBones atlas pages.** A published scene transfers each page to its skeleton so characters can keep drawing until their last instance leaves.
