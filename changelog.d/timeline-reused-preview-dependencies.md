---
section: Changed
commits:
  - perf(editor): avoid revisiting shared timeline preview dependencies
---
**Timeline previews prepare reused nested clips faster.** The Sequencer and grip preview resolve aliases and visit shared assets once at each shallowest reached depth, reducing repeated work when the same clips are used in many places.
