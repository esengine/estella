---
section: Fixed
commits:
  - fix(editor): restore deleted selections in one hierarchy pass
  - fix(project): ship reliable batch deletion undo
---
**Deleting and restoring scene selections follows the actual parent links.** Older scenes with stale child lists keep unrelated entities in place. Undo restores the entire selection and its references with one world-order update.
