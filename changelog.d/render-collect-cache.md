---
section: Changed
commits:
  - perf(render): what a frame collects is kept while what it was collected from stands - placement sets keep their culling boxes and instance records between walks, the record texture uploads only the rows that changed, the shadow map holds the casters that did not move and collects only the movers, and the rain cover map is not drawn again while what stands over the camera is the same
---
**Large 3D scenes spend far less of a phone's frame collecting what to draw.** A set of placements (grass, flowers, trees) keeps its culling boxes and instance records from frame to frame instead of working each one out again, and the instance-record texture uploads only the rows that changed. The shadow map holds the casters that stood still and collects again only the few that move (a floating crate, a door), so one moving object no longer makes every caster be gathered again; a scene whose wind bends its plants still keeps its collect and only redraws the map. The rain cover map is no longer drawn every frame: while the camera stays in the same texel of its grid and nothing over it changes, the map drawn before is used. What is drawn is unchanged.
