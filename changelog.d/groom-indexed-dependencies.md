---
section: Fixed
commits:
  - fix(assets): follow the groom's authored geometry and materials
---
**Grooms keep their strands and distant hair cards in exported games.** Dependency scanning follows the curve, mesh and material references the groom uses, including indexed paths without extensions. The cooker resolves them against the authored groom before staging the files.
