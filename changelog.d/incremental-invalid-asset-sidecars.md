---
section: Fixed
commits:
  - fix(assets): reconcile invalid sidecars during incremental scans
---
**The editor’s asset index drops entries with invalid sidecars.** Incremental scans report the same metadata problem as a full scan, re-resolve affected references, and restore the asset when its metadata is repaired.
