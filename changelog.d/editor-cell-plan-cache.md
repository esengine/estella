---
section: Changed
commits:
  - perf(editor): reuse world partition plans when toggling cells
  - perf(project): ship cached editor cell plans
---
**Loading and unloading cells is faster in large streamed worlds.** The editor reuses the partition across cell toggles and rebuilds it when scene edits or component registrations change the information used to place entities and check their references.
