---
section: Fixed
commits:
  - fix(picking): exclude inactive entities from world ray picks
  - fix(editor): exclude inactive entities from viewport marquee picks
---
**Inactive objects stay out of viewport picks.** Click and marquee selection use the engine's effective activity, including a disabled parent. Re-enabling a branch makes its active objects selectable again without changing the scene hierarchy.
