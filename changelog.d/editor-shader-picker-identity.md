---
section: Fixed
commits:
  - fix(editor): keep shader picker focus through asset renames
---
**The material Shader picker follows asset renames while open.** Keyboard focus stays on the same shader as the list refreshes. Shaders with the same filename show their project paths so each can be identified.
