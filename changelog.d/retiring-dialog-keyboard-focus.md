---
section: Fixed
commits:
  - fix(ui): exclude retiring dialogs and controls from keyboard focus
---
**Dialogs and controls that are being destroyed stop receiving keyboard input immediately.** A retiring inner dialog releases the Tab scope back to the remaining dialog without activating its old controls.
