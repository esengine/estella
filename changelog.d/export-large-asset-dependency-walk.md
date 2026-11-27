---
section: Changed
commits:
  - perf(export): walk asset dependencies without shifting the queue
---
**Export traverses large asset dependency lists with less work.** The cook uses one ordered map to discover assets and record why they are included. It keeps the same breadth-first order and shortest paths in the size report.
