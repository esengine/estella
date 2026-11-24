---
section: Fixed
commits:
  - fix(ecs): finish subtree destruction in its owning world
---
**Restarting a 2D or 3D world from a destruction callback preserves the new scene hierarchy.** The outgoing world finishes its callbacks and releases its subtree before detaching. A replacement sprite or mesh can immediately reuse an entity number, take a parent and keep its assets. Restoring an editor snapshot stops if a callback opens a different world.
