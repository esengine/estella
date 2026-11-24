---
section: Fixed
commits:
  - fix(editor): a UI node created under a FlexContainer stays in its layout
---
**UI elements created inside a layout container join its layout.** A Text, Button or other UI element created or
dropped under a node with a `FlexContainer` was switched to absolute positioning at the centre or the drop point, so it
ignored the container's row or column and overlapped its siblings. Such nodes now stay in the container's flow;
elements created directly under a plain Canvas are still placed at the drop point or centred as before.
