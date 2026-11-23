---
section: Fixed
commits:
  - fix(groom): cards shade as the strands they stand in for, and a two-sided card's strands run one way on both faces
  - fix(editor): a groom's textures are imported as data, and its group materials are read beside it as its curves are
---
**A groom's cards look like its strands from every side.** Cards baked from a groom were cooler and duller than its strands,
most of all from behind. Three causes, all fixed: the Hair shader read a card's strand direction with the normal already
turned for a back face, so on the far side of a two-sided card the strands ran backwards and the warm second highlight
went astray (every two-sided card with a flow map had this); a card's highlight was shifted by the default shift map's
white; and a card was lit with its own face's normal and its texels took the root's shading from whichever strand lay
nearest, which near a head is a root. The Strands and Hair shaders now share one strand look (a cylinder's normal round
the strand, the darkening and occlusion toward the root), the Hair shader's `u_strandNormal` lights a card that way and
`u_rootColor` gives it the root's colour, the baked Attribute red is the average over the strands a texel holds, and the
cards material takes every lobe and its shadow density from the Strands shader and the groom. Lit the same, a card and
its strands now measure within a few levels of each other. A groom's baked textures are imported as data (not
compressed or filled as a picture), and a group's material path is read beside the `.esgroom` like its curves.
