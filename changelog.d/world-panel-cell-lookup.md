---
section: Changed
commits:
  - perf(editor): index world panel cell residency
---
**The editor's World panel responds faster in worlds with many cells.** The map and list reuse an index of loaded cells, and the panel builds map data only while the map is open.
