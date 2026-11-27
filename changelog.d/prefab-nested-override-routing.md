---
section: Changed
commits:
  - perf(prefab): route nested overrides by slot
---
**Scenes with many customized nested prefabs expand faster.** The engine indexes each override by its addressed slot during prefab expansion, so each slot reads only the overrides that apply to it.
