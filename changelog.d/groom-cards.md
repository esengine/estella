---
section: Added
commits:
  - feat(groom): hair cards along a groom's guides, and the Hair material reads the strands textures baked onto them
  - feat(editor): Create Hair Cards on a groom makes the cards, bakes the strands onto them and writes the material that draws them
---
**A groom makes its own hair cards.** Right-click a `.esgroom` for **Create Hair Cards** (or the agent tool `groom_cards`):
a card along each guide, faced out from the head, each in a UV cell of its own, written as `<groom>_Cards.esmesh`; the
strands are baked onto them (Depth, Coverage, Tangent, Attribute), and `<groom>_Cards.esmaterial` draws them as the
groom, in its colour. Put that mesh and material on the Groom's entity and the hair draws as cards: a far level of
detail, or hair for a device that does not draw strands. The built-in Hair material reads the baked textures:
`u_coverageMap` (opacity), `u_depthMap` (layers under others darker, `u_depthShade`), `u_attributeMap` (darker roots,
and `u_strandTone` / `u_strandShift` for each strand its own tone and highlight), with the strand direction in
`u_flowMap`; Create Strands Textures writes the same material for a mesh of your own. Baking again keeps what was set
in the material. A strand counts at least half of each texel it crosses, so a card baked from strands of a real hair's
width is not nearly clear.
