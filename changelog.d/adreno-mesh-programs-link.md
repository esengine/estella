---
section: Fixed
commits:
  - fix(render): a mesh draws on Adreno 6xx phones - a draw's entry and its shapes' weights are texels of the frame's record texture, so no vertex stage indexes a uniform array by gl_DrawID or a loop counter
---
**A mesh draws on Adreno 6xx phones.** On a Pixel 5 (Adreno 620) and phones like it, every 3D mesh was missing: the driver refused
to link the mesh programs ("cannot compute gv size for oob"), so a scene showed its sky and nothing standing in it. The vertex stage
looked up a multi-drawn draw's records and a morphed mesh's shape weights in uniform arrays indexed by `gl_DrawID` and a loop
counter, which those drivers cannot compile. Each draw now has an entry in the frame's record texture, beside the records it places,
and a morphed draw's weights follow it there, so the vertex stage reads both with a texel fetch on every backend. A material's mesh
variant now blends as many shapes as a built-in mesh does (64, not 8).
