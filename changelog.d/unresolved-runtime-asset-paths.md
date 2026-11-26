---
section: Fixed
commits:
  - fix(assets): keep unresolved paths in runtime scene snapshots
---
**Failed runtime asset loads preserve their authored paths in scene snapshots.** The Play Inspector and saved snapshots keep the path available for retry until the field is replaced or cleared.
