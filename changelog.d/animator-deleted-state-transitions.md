---
section: Fixed
commits:
  - fix(animation): ignore transitions to deleted Animator states
---
**Deleted Animator states no longer interrupt playback through old transitions.** Deleting a state also removes its Any State transitions from the edited layer. Existing controllers skip transitions with missing destinations and keep their triggers available for valid transitions.
