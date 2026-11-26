---
section: Fixed
commits:
  - fix(editor): preserve focus moved by a dropdown selection
  - fix(editor): ship focus-safe dropdown selections
---
**Dropdowns preserve focus moved by a selection.** When an option focuses another field, closing the list leaves that field ready for typing. Tab advances from the trigger in panel order.
