---
section: Added
commits:
  - feat(groom): hair grows in the engine from parameters, a .esgroom with `grow` in place of a curves file
  - fix(groom): strands thinner than a pixel keep their coverage as a share of pixels, so fine hair is drawn
  - feat(editor): groom_write and groom_read grow hair from parameters, and the Groom editor shows hair grown from them
---
**Hair and fur grow in the engine from parameters.** A `.esgroom` can hold `grow` in place of a curves file: a scalp
(an ellipsoid with a hairline at the forehead, the ears and the nape), a part or a comb direction, length, lift,
stiffness, what the hair rests on (neck, shoulders, back), locks that clump toward the tip, waves, frizz, flyaways, a
cut, colours and widths. The engine grows the strands when the groom loads, the same on every device from the same
seed, so a groom needs no DCC tool and no curves file, and changing a number changes the hair everywhere it is drawn.
The Groom editor shows grown hair like hair from Blender, and the editor's MCP tools `groom_write` and `groom_read`
write one and answer with the hair from three sides and its measurements. Strands thinner than a pixel, which real
hair widths are at any distance, now keep their coverage as a share of the pixels they cross, so a temporal
anti-aliasing resolve draws them as soft hair; before, a strand narrower than half a pixel was not drawn at all.
