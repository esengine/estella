---
section: Fixed
commits:
  - fix(editor): validate timeline paths in scene sibling order
  - fix(project): ship consistent timeline target paths
---
**The Sequencer offers paths that can be reached in scene order.** When siblings have the same name, the first matches playback and a later sibling's hidden branch is excluded from the picker. Timeline tools reject entity IDs whose saved name path would resolve elsewhere.
