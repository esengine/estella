---
section: Fixed
commits:
  - fix(assets): keep hot replacements with the scope holding the outgoing binding
---
**Hot updates preserve scene and entity ownership when both supply assets to one entity.** Updating a sprite or mesh texture now releases the old generation from its owning scope. Scene textures remain available until their scene unloads, and private textures are released when their entity despawns.
