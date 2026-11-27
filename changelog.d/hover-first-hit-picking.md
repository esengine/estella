---
section: Changed
commits:
  - perf(editor): stop hover picking at the first ranked hit
---
**Faster hover picking over UI.** A topmost HUD hit can finish before the editor checks the world behind it. Selection cycling still collects the complete stack.
