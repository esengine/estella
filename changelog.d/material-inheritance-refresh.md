---
section: Fixed
commits:
  - fix(material): refresh inherited properties after dependency changes
  - fix(editor): ship live material inheritance refresh
---
**Open material instances refresh when a parent material or shader changes on disk.** The inspector updates the inherited values while preserving the child's unsaved overrides.
