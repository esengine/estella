---
section: Changed
commits:
  - perf(editor): reuse prefab baselines while saving scenes
  - perf(prefab): share prepared scene-instance baselines with the editor
---
**Saving scenes with repeated nested prefabs is faster.** The editor reuses the flattened prefab data for instances that share the same source snapshot, while calculating each instance's overrides separately.
