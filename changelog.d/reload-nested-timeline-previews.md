---
section: Fixed
commits:
  - fix(sequencer): reload nested timelines after disk changes
  - fix(editor): ship nested timeline preview refresh
---
**Open timeline previews pick up changes to nested clips on disk.** Sequencer and the Grip viewport refresh after the asset index updates, and unchanged nested clips can stay cached.
