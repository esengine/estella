---
section: Fixed
commits:
  - fix(ui): render text fields consistently across edit and play
  - fix(editor): preview localized input hints and recover unavailable languages
---
**The preview language now applies to input placeholders in both 2D and 3D scenes.** Switching back to Auto restores the authored hint. Removing a field clears its generated background and clipping mask and preserves your own skin and mask. Fields also show their values on a host without a keyboard. The preview language menu lets you return to Auto after its last table disappears, and calculates untranslated counts when you open it.
