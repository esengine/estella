---
section: Fixed
commits:
  - fix(ecs): advance component revisions on entity destruction
---
**Hierarchy queries drop entities destroyed by the engine.** The registry now advances the revisions of the removed components, so cached `Parent` and `Children` results stop returning destroyed entities.
