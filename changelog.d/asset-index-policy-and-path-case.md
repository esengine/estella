---
section: Fixed
commits:
  - fix(editor): refresh asset watcher mounts after exclusion changes
  - fix(assets): reconcile exclusions and case-only renames in the index
---
**The live asset index follows folder exclusions and Windows case-only renames.** Changing the project's content exclusions updates the index and resumes watching folders that come back into scope. Renaming only the capitalization preserves the asset's UUID and records the spelling on disk.
