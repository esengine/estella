---
section: Fixed
commits:
  - "fix(sequencer): preserve scene edits under timeline preview"
  - "fix(editor): ship authored pose restoration during preview"
---
**Timeline preview restores the latest scene edits.** Editing a previewed component updates its base pose, so the viewport keeps sampling the timeline and returns to the edited values when preview ends.
