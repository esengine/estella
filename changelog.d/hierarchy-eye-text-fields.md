---
section: Fixed
commits:
  - fix(editor): preserve preview state when toggling hierarchy visibility
  - fix(ui): respect editor visibility for generated input visuals
---
**Hiding a group now also hides the text and automatic background of its input fields in 2D and 3D views.** Showing the group restores the current field values and preserves each child’s own visibility setting. Toggling a large group takes less time and preserves live preview colors. In the Outliner, the eye distinguishes a hidden parent from a locally hidden row. Use the arrow keys to choose a row, then Tab to its eye and press Space or Enter.
