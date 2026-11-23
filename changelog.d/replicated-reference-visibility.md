---
section: Fixed
commits:
  - fix(net): keep entity references current across visibility and replication changes
---
**Replicated entity references follow their targets in and out of each client's view.** A reference reads `0` while its target is absent and resolves to the current local entity when it appears again. This also works when the server adds or removes `Replicated` on the target without editing the referring component. Ordered lists, buffered interpolation and client prediction follow the same rule.
