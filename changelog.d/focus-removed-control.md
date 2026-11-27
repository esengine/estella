---
section: Fixed
commits:
  - fix(ui): deliver blur when a live control loses focusability
---
**A live UI control emits Blur when its Focusable component is removed.** If a blur handler moves focus, keyboard activation queued for the removed control stays cancelled.
