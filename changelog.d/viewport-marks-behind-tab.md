---
section: Fixed
commits:
  - fix(viewport): gizmo marks stay hidden while the scene tab is behind another
---
**The scene view's marks no longer show through the tab in front of it.** With an entity selected whose children have icons, such as a character's skeleton, opening another editor in the same dock (the animation controller, say) left those icons drawn over it. They now hide with the scene view.
