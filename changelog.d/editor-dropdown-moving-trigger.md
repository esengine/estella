---
section: Fixed
commits:
  - fix(editor): dismiss dropdowns when their trigger shifts within a dock
---
**Dropdowns stay aligned with their toolbar controls.** A change to nearby controls can move the trigger without resizing the panel. The open menu closes and keyboard focus returns to its trigger, ready to reopen at the new position.
