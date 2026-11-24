---
section: Fixed
commits:
  - fix(particles): isolate simulation and rendering per world
---
**Particle effects stay with their scene when several worlds share an engine.** Each 2D or 3D scene now saves its own gradients, size curves and burst schedules. Updating, resetting or closing a preview preserves the other world's live particles and collision results, including effects simulated on the GPU. A GPU emitter also draws its new burst when it resets and restarts in the same frame.
