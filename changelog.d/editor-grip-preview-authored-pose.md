---
section: Fixed
commits:
  - "fix(editor): share authored pose restoration between clip previews"
  - "fix(editor): ship authored pose restoration for grip previews"
---
**Grip preview restores the latest scene edits.** Grip and Sequencer share base-pose snapshots. The grip clip continues sampling in the viewport, and clearing it restores the edited values even if the edit and clear happen in the same frame.
