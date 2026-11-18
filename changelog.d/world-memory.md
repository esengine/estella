---
section: Added
commits:
  - feat(residency): RememberState keeps an entity as it was left when its cell unloads, and keeps it gone once destroyed - a streamed world's memory, carried through a save with WorldMemoryRes
---
**A streamed world remembers what happened in a cell after you walk away.** A cell that unloads used to come back exactly as authored: an enemy you wounded was at full health again, a looted chest was full, a boss you killed stood back up. Put `RememberState` on what should not: as it is taken out with its cell, its game components (the ones a project defines, such as `Health` or a chest's opened flag) and its Transform are kept under the id it was authored with, and when the cell comes back its document is changed before anything spawns, so it arrives as it was left and never shows for a frame as authored. A remembered entity destroyed while its cell is in stays destroyed, with everything under it. The memory is the `WorldMemoryRes` resource; `toJSON` and `read` carry it through a save slot, and `clear` starts a new game.
