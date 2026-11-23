---
section: Added
commits:
  - feat(groom): a groom bakes a follicle mask and strands textures on the GPU
  - fix(render): a pass that draws data into a render target is left alone by the post chain
  - feat(editor): Create Follicle Texture and Create Strands Textures on a groom, with their options, and the agent tools that bake them
---
**A groom bakes a follicle mask and strands textures.** Right-click a `.esgroom` in the Content Browser for
**Create Follicle Texture** and **Create Strands Textures**. The follicle mask draws a small distance field round every
strand root at its root UV, each groom in a colour channel of its own (Resolution, Root Radius, Grooms with their
Channel), for a skin material to blend the scalp into the hair. The strands textures lay the strands onto a mesh's UVs
(Trace Type outside, inside or both, Trace Distance, Mesh, UV Channel Index, Group Index) and write Depth, Coverage,
Tangent and Attribute textures beside the groom, read as numbers, for hair cards or a hair shell that look like the groom
from a distance. Both are drawn on the GPU, on WebGL2 and WebGPU alike; the agent tools `groom_follicle_texture` and
`groom_strands_textures` do the same and answer with the pictures. `RenderTexture.begin` takes `{ data: true }` for a
pass that writes numbers: a project with a linear colour space or an output transform no longer tone maps what is drawn
into it.
