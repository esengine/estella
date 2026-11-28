---
section: Fixed
commits:
  - fix(render): stop obsolete scene shader waits and report timeouts
---
**Discarded scene preparations stop checking shader readiness.** A scene whose shader compilation times out remains pending and can be checked again instead of being reported ready.
