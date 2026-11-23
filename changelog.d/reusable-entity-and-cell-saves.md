---
section: Fixed
commits:
  - fix(persist): keep restored entities and streamed cell saves independent
---
**The same save can be restored more than once without one copy changing the next.** Editing an inventory on a restored entity leaves the snapshot and sibling inventories intact. Restoring over a replicated entity preserves its live network identity even when the component has a serialization alias. Streamed worlds keep their saved values separate from imported and exported data. Starting a new game from cached cell data restores the original parent and child links.
