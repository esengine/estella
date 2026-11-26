---
section: Fixed
commits:
  - fix(persist): filter snapshots before export and keep flush errors on the queue
---
**World persistence reports a failed flush through its returned promise.** Queued flushes can retry unwritten records. Component filters also skip copying and exporting excluded data.
