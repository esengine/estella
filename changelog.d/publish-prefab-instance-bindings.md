---
section: Fixed
commits:
  - fix(editor): publish prefab edits without replacing the scene instance
  - fix(prefab): keep scene bindings when publishing instance edits
---
**Applying a prefab or creating a variant preserves the scene instance and its bindings.** The Apply preview shows which changes other instances will inherit. References to scene objects stay with the instance that picked them, including entries in skin joint lists. Creating a variant keeps the selection and attachments, and its scene link can be undone in one step.
