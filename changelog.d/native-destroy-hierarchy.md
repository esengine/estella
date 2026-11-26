---
section: Fixed
commits:
  - fix(ecs): clear hierarchy components during native entity destruction
---
**Deleting an entity through the native registry now updates the hierarchy seen by scripts and inspectors.** Surviving children become roots, and a surviving parent’s child list no longer includes the deleted entity.
