---
section: Changed
commits:
  - perf(editor): reuse current textures for material parameter edits
---
**Editing scalar material parameters reuses the textures already bound to the live preview.** Changed texture references and reloaded assets still take effect.
