---
section: Fixed
commits:
  - fix(assets): keep hot replacements with the scope holding the outgoing binding
  - fix(assets): reconcile mixed-owner fields against their pre-update receipts
---
**Hot updates preserve scene and entity ownership when both supply assets to one entity.** Updating a sprite or mesh texture now releases the old generation from its owning scope. Scene textures remain available until their scene unloads, and private textures are released when their entity despawns. An observer can also restore the previous texture during an update without keeping an unused replacement.
