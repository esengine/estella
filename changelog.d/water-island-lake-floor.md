---
section: Added
commits:
  - feat(water): an island raises the terrain out of the water, and a lake cuts its floor into it
---
**Islands, and lakes that cut their floor.** A WaterBody can now be an **Island**: inside its rectangle or outline the terrain is raised to the island's own height, easing back down to the ground over its Shore Width outside it, so the sea or lake round it leaves it dry. A lake's **Bed Depth** (until now a river's alone) cuts its floor into the terrain under its outline, sloping down from the shore to that depth. Both are laid over the terrain without changing it: move or remove the body and the ground is as it was. A lake only cuts and an island only raises, so either can sit over sculpted ground, and the terrain's height range now grows to hold what they make, so an island over the highest hill or a floor under the lowest valley is no longer held at the edge of the range.
