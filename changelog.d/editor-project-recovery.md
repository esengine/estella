---
section: Fixed
commits:
  - fix(editor): recover project documents and rebuild their runtime assets
  - fix(project): ship project-scoped document recovery
---
**Crash recovery now restores the assets a project actually uses.** Restoring a 2D rig rebuilds its skinned mesh and prefab and updates animation bone paths. Restoring a material graph or a nested subgraph recompiles the affected shaders. Recovery refreshes the matching open document and keeps the timeline preview binding and frame rate. Cancel keeps the copies for later. Switching projects closes the old prompt, and an interrupted recovery can be retried.
