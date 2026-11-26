---
section: Changed
commits:
  - perf(editor): coalesce Play inspector refresh bursts
---
**Rapid edits and selection changes send fewer inspection requests during Play.** Edits still reach the game individually. The next inspector refresh uses the latest selection and includes any pending hierarchy update.
