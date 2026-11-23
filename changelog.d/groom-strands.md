---
section: Added
commits:
  - feat(groom): hair and fur as strands, read from a Blender export and drawn group by group
---
**Hair and fur can be strands, not only cards.** A `Groom` component draws a `.esgroom`: the curves of a groom exported from
Blender (`tools/blender/export_groom.py` writes them, one group per Curves object or per `groom_group_id`, guides marked by
`groom_guide`), each group a ribbon per strand that faces the eye, lit along the strand. Each group has its own material, Hair
Width (in centimetres, or the width the curves carry), Hair Root Scale and Hair Tip Scale, Hair Shadow Density, whether it casts
shadows, and Stable Rasterization, which draws a strand at least a pixel wide with its coverage cut to match. The figures a
Strands panel shows (curves and points of the strands and of the guides, the widest strand, points per curve, the attributes) come
from `groupStats`. Grooms are in `esengine/groom`. They do not follow a skinned mesh or simulate yet, and a dense groom's shadow on
itself is noisy.
