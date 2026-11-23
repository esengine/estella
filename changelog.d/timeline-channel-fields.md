---
section: Changed
commits:
  - perf(timeline): reuse parsed property paths across channel samples
  - perf(timeline): share field bindings across reloaded clips
---
**Timeline playback spends less time resolving animated fields.** Sprite fades, skeletal animation, editor previews and root motion share parsed property paths across samples and freshly loaded clips. Editing the path takes effect on the next sample.
