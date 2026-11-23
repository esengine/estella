---
section: Fixed
commits:
  - fix(scene): reset scene services without orphaning live assets
---
**Resetting the scene manager keeps loaded sprites and meshes drawable.** Entities from a loaded scene keep the assets they use and recover their visibility from before scene sleep. Reset also removes the old scene systems, cancels pending loads and transitions, and releases unused preparations. Registering the same scene again starts it with a single set of systems.
