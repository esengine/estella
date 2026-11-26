---
section: Fixed
commits:
  - "fix(sequencer): choose sequence roots by binding path"
  - "fix(editor): ship bound roots for nested timeline clips"
---
**Sequencer can bind a nested timeline to an external entity.** The sequence root picker offers the player's bindings and their descendants, and saves the chosen path. If a target is renamed, the old path remains visible for repair and cannot redirect a pending selection to another entity.
