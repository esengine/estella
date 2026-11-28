---
section: Fixed
commits:
  - fix(assets): cancel batches waiting for subpackages on reset
---
**Resetting assets releases batches that are waiting for minigame subpackages.** An abandoned group, label, or explicit preload can reject while the host mount is still pending. New requests can share that mount, and abandoned batches start no further asset loads.
