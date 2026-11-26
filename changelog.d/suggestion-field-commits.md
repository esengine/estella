---
section: Fixed
commits:
  - fix(editor): avoid duplicate suggestion field writes on blur
  - fix(editor): ship single writes from suggestion fields
---
**Editable suggestion fields save each edit once.** Tabbing past an unchanged field skips the write, and Escape restores the last confirmed value while the editor applies it.
