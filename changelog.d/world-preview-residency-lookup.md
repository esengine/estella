---
section: Changed
commits:
  - perf(editor): reuse indexed world preview residency
---
**Large streamed worlds take less editor CPU time to show residency during Play.** The World panel and viewport overlay share the state lookup for each runtime report.
