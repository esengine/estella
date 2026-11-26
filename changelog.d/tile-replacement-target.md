---
section: Fixed
commits:
  - fix(editor): keep tile replacement bound to the opening layer
  - fix(project): ship tile replacement target checks
---
**Replace Tiles stays tied to the chosen layer.** The layer panel offers replacement only for a tile layer. Changing the
selection or replacing the scene closes the dialog and clears its replacement preview.
