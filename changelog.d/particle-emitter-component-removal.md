---
section: Fixed
commits:
  - fix(particle): retire simulation state with its emitter component
---
**Replacing a particle emitter starts a fresh simulation on that entity.** The previous emitter's particles, gradients, curves, and bursts are released when the component is removed.
