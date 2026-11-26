---
section: Changed
commits:
  - perf(editor): reuse scene data between Outliner projections
  - perf(project): ship faster Outliner searches in large scenes
---
**Searching and sorting the Outliner takes less work in large scenes.** The panel reuses the current scene tree and component names between queries. Changes such as renaming an entity or removing a component still update active search results.
