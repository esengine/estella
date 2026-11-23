---
section: Changed
commits:
  - perf(timeline): reuse parsed property paths across channel samples
---
**Timeline playback spends less time resolving animated fields.** Sprite fades, skeletal animation, editor previews and root motion reuse each curve's property path across samples. Editing the path takes effect on the next sample.
