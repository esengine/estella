---
section: Fixed
commits:
  - fix(runtime): resolve mini-game scene files through the package manifest
---
**Mini-game exports resolve scene paths through the package manifest.** Startup reads the staged entry scene, and later scene switches use the staged paths without loading those scenes upfront.
