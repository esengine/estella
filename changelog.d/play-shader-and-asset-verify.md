---
section: Fixed
commits:
  - fix(asset): load the shader a material names in the running game
  - fix(verify): count an asset the game failed to load as an error
---
**A material made by `shader_write` draws in Play, and `verify` fails when an asset does not load.** Play fetched the shader
a material names from its own page folder, so every such surface drew as the default while the editor drew it right; it now
loads from the project. An asset the running game could not load was only a warning in the log, which `verify` let pass; it
is now a failed `errors` check that says which asset and what to look at.
