---
section: Fixed
commits:
  - fix(editor): refresh lightmap status when sampled textures change
  - fix(lighting): fingerprint the textures sampled by a lightmap bake
---
**Lighting status detects changes to the textures and material cutoffs used by a bake.** Editor and command-line bakes record the same texture signature, including inherited material inputs. The Lighting panel refreshes the status when project files change.
