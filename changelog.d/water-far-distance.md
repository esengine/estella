---
section: Added
commits:
  - feat(water): the far distance mesh past a zone's rings has its own extent, material and switch
---
**Far distance settings on the Water Zone.** Past the rings a zone draws a flat sea out to the horizon, so an ocean does not end in a straight line where its detailed surface does. It was always 80 km and drawn with the ocean's own material; the new **Far Distance** group on WaterZone sets whether it is drawn (**Far Distance**), how far it reaches (**Far Distance Extent**), the material it is drawn with (**Far Distance Material**: a cheaper one matched to the ocean, or empty for the zone's water) and whether a zone with only lakes and rivers draws it too (**Far Mesh Without Ocean**, laid at the zone's own height). A zone with no ocean no longer draws it unless asked.
