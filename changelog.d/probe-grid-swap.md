---
section: Fixed
commits:
  - fix(editor): a probe grid assigned after the scene opened reaches its volume - the hot load recorded the grid's handle, but the resolver read only the material, font, mesh and environment handles, so a LightProbeVolume given a new .esprobes read nothing until the scene was reopened; it now reads every handle the slot table records
---
**A probe grid assigned to a LightProbeVolume after the scene opened now lights it in the editor.** The new `.esprobes` was loaded, but the editor never handed its handle to the volume, which read nothing (and showed no probes) until the scene was reopened.
