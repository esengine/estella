---
section: Added
commits:
  - "feat(ui): add UIMeter, a meter whose ghost shows how much a blow took"
---
**A UIMeter shows how much a blow took.** Put it on a health or stamina bar's track, point its `fill` and `ghost` at two Filled
UI visuals, and write only `value` (0..1). A drop shows in the fill at once; the ghost behind it keeps the old amount for
`holdTime`, then eases down over `fallTime`, and hits in a row keep it up so a combo reads as one loss. A rise climbs over
`riseTime`. Outside Play the meter shows its value as it is, so it can be placed and judged in the editor.
