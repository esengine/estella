---
section: Fixed
commits:
  - fix(runtime): detach script component values from world snapshots
---
**Runtime inspection captures script component values at the time of the snapshot.** Later edits to nested records or to pooled numeric fields leave previously captured values intact.
