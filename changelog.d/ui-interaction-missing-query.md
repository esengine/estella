---
section: Changed
commits:
  - perf(ui): cache the set of controls missing interaction state
---
**UI interaction avoids rescanning initialized controls when unrelated scene entities come and go.** New controls and controls missing their transient state still get initialized before pointer handling.
