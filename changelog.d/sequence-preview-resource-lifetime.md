---
section: Fixed
commits:
  - fix(sequencer): isolate pending timeline reads by project
  - fix(editor): ship project-safe timeline dependency loading
---
**Timeline previews handle project changes while nested clips are loading.** Grip and Sequencer share pending reads, retry against the current index if it changes during a load, and discard late reads from a closed project.
