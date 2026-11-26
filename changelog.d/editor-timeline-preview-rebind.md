---
section: Fixed
commits:
  - "fix(sequencer): restore preview poses when scene bindings change"
  - "fix(editor): ship timeline preview rebinding"
---
**Timeline preview restores poses when its scene targets change.** The previous target returns to its base pose and the new target gets its own snapshot. Opening or rebuilding a scene also clears snapshots from the previous world before previewing the new one.
