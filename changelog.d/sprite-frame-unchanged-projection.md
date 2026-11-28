---
section: Changed
commits:
  - perf(animation): skip unchanged sprite frame projections
---
**Frames with the same appearance no longer rewrite the Sprite component.** The animation still advances and dispatches frame events, while the renderer receives Sprite changes only when a displayed field changes.
