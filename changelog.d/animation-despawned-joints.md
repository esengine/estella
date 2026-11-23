---
section: Fixed
commits:
  - fix(animation): release sampled pose data when its entity leaves the world
---
**Removing an animated character or joint releases its sampled component data.** Timelines, animation controllers and blend trees can keep playing while parts of a rig are replaced. A replacement engine registry also starts from its own rest poses when it reuses entity handles.
