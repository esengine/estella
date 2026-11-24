---
section: Fixed
commits:
  - fix(editor): a dock group's chevron collapses it after a collapsed group was moved beside the viewport
---
**A dock group's collapse chevron works after you rearrange the dock.** A collapsed group dragged by its header beside
the viewport kept the height lock that holds a collapsed group at its tab strip, and the row it joined could then grow
no taller: the group under that row could no longer shrink, so its chevron did nothing until Window > Reset Layout. A
collapsed group that the layout stretches open now drops its lock.
