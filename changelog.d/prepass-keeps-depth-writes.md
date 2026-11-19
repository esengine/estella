---
section: Fixed
commits:
  - fix(render): a draw that did not take the depth prepass is not lost after it on D3D11 with a multisampled target - the colour pass after a prepass switched the draws that took it to testing depth without writing it, and on ANGLE's D3D11 backend with four samples a draw that writes depth after draws that only test it is not drawn at all (the same calls on its GL and Vulkan backends draw it), so with the prepass on a cut-out the prepass has no program for, a wood of trees on the foliage material, vanished with only its shadows left; the draws that took the prepass now go on writing the depth that is there already
---
**With the depth prepass on, cut-out foliage is no longer missing on Windows browsers at the high quality level.** A cut-out material other than Model's has no prepass program, so it is drawn in the colour pass and writes its own depth there; after the draws that took the prepass, which only tested depth, ANGLE's D3D11 backend dropped such a draw whole on a four-sample target. A wood of trees disappeared and left its shadows. The prepassed draws now keep writing depth in the colour pass, and the trees are drawn at every quality level.
