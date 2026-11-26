---
section: Fixed
commits:
  - fix(sequencer): validate new sequence references before editing
  - fix(editor): ship validation for newly selected sequences
---
**New nested sequence references are checked before the timeline changes.** Adding or replacing a clip reads its dependencies the first time, rejects cycles, unreadable files and excessive nesting, and uses the actual clip length when adding from the Sequencer menu.
