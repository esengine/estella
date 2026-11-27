---
section: Fixed
commits:
  - fix(world): validate manifests before changing residency
---
**A malformed streaming manifest leaves the active world loaded.** Play and packaged games report invalid grid data and conflicting scene names before publishing a new world, so the switch can be retried after the manifest is fixed.
