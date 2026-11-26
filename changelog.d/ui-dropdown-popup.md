---
section: Fixed
commits:
  - fix(ui): keep dropdown options visible and selectable across canvas edges
---
**Game UI dropdowns keep their options within the screen’s safe area.** The dropdown in the editor’s widget palette and its SDK factory show an arrow, align labels to the left, and mark the selected row with a check. Menus open above a trigger when space below is tight and scroll independently of a clipped parent. Keyboard navigation keeps the selected row visible, and dragging a list no longer selects the row under the pointer when it lifts.
